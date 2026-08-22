import childProcess, { type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  ScryptedMimeTypes,
  type EndpointManager,
  type FFmpegInput,
  type HttpRequest,
  type HttpResponse,
  type MediaManager,
  type MediaObject,
} from '@scrypted/sdk';
import type { Go2rtcConfig } from './types';
import { Go2rtcClient } from './go2rtc-client';

export interface IntercomAudioSource {
  readonly done: Promise<void>;
  stream(): AsyncGenerator<Buffer, void>;
  stop(): Promise<void>;
}

export interface IntercomAudioSourceFactory {
  create(media: MediaObject): Promise<IntercomAudioSource>;
}

export class ScryptedFfmpegAudioSourceFactory implements IntercomAudioSourceFactory {
  constructor(private readonly mediaManager: MediaManager) {}

  async create(media: MediaObject): Promise<IntercomAudioSource> {
    const inputBuffer = await waitWithTimeout(
      this.mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput),
      10_000,
      'Scrypted intercom media conversion timed out',
    );
    const input = JSON.parse(inputBuffer.toString()) as FFmpegInput;
    const inputArguments = input.inputArguments?.length
      ? [...input.inputArguments]
      : input.url
        ? ['-i', input.url]
        : [];
    if (!inputArguments.length)
      throw new Error('Scrypted intercom media did not provide FFmpeg input arguments');

    const ffmpegPath = input.ffmpegPath || await waitWithTimeout(
      this.mediaManager.getFFmpegPath(),
      5000,
      'Scrypted FFmpeg path lookup timed out',
    );
    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      ...inputArguments,
      '-vn',
      '-acodec', 'pcm_alaw',
      '-ac', '1',
      '-ar', '8000',
      '-f', 'wav',
      'pipe:1',
    ];
    const process = childProcess.spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: input.env ? { ...processEnv(), ...input.env } : processEnv(),
    });
    return new FfmpegAudioSource(process);
  }
}

function processEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

class FfmpegAudioSource implements IntercomAudioSource {
  readonly done: Promise<void>;
  private stopped = false;

  constructor(private readonly process: ChildProcess) {
    this.done = new Promise<void>((resolve, reject) => {
      process.once('error', reject);
      process.once('exit', () => resolve());
    });
    process.stderr?.resume();
  }

  async *stream(): AsyncGenerator<Buffer, void> {
    const stdout = this.process.stdout as Readable | null;
    if (!stdout)
      throw new Error('FFmpeg intercom output pipe is unavailable');
    for await (const chunk of stdout)
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }

  async stop(): Promise<void> {
    if (this.stopped)
      return;
    this.stopped = true;
    if (this.process.exitCode !== null || this.process.signalCode !== null)
      return;
    this.process.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (this.process.exitCode === null && this.process.signalCode === null)
        this.process.kill('SIGKILL');
    }, 2000);
    timer.unref?.();
    await this.done.catch(() => undefined);
    clearTimeout(timer);
  }
}

interface RegisteredIngress {
  source: IntercomAudioSource;
  claimed: boolean;
  connected: Promise<void>;
  resolveConnected: () => void;
  onFinished: () => void;
}

export class IntercomIngressRegistry {
  private readonly entries = new Map<string, RegisteredIngress>();

  register(source: IntercomAudioSource, onFinished: () => void): { token: string; connected: Promise<void> } {
    const token = randomBytes(24).toString('hex');
    let resolveConnected: () => void = () => undefined;
    const connected = new Promise<void>(resolve => {
      resolveConnected = resolve;
    });
    this.entries.set(token, { source, claimed: false, connected, resolveConnected, onFinished });
    return { token, connected };
  }

  remove(token: string): void {
    this.entries.delete(token);
  }

  async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
    const token = this.tokenFromRequest(request.url || '');
    const entry = token ? this.entries.get(token) : undefined;
    if (!entry) {
      response.send('Not found', { code: 404, headers: { 'Cache-Control': 'no-store' } });
      return;
    }
    if (entry.claimed) {
      response.send('Intercom ingress is already connected', { code: 409, headers: { 'Cache-Control': 'no-store' } });
      return;
    }
    entry.claimed = true;
    entry.resolveConnected();
    response.sendStream(this.wrapStream(entry), {
      code: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'audio/wav',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  private async *wrapStream(entry: RegisteredIngress): AsyncGenerator<Buffer, void> {
    try {
      yield* entry.source.stream();
    }
    finally {
      entry.onFinished();
    }
  }

  private tokenFromRequest(rawUrl: string): string | undefined {
    try {
      const url = new URL(rawUrl, 'http://scrypted.invalid');
      const filename = url.pathname.split('/').filter(Boolean).at(-1);
      const match = filename?.match(/^([a-f0-9]{48})\.wav$/);
      return match?.[1];
    }
    catch {
      return undefined;
    }
  }
}

interface ActiveIntercom {
  token: string;
  source: IntercomAudioSource;
  client: Go2rtcClient;
}

export class Go2rtcIntercom {
  private active?: ActiveIntercom;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly registry: IntercomIngressRegistry,
    private readonly sourceFactory: IntercomAudioSourceFactory,
    private readonly endpointManager: EndpointManager,
  ) {}

  start(media: MediaObject, config: Go2rtcConfig): Promise<void> {
    return this.serialized(async () => {
      await this.stopActive();
      const source = await this.sourceFactory.create(media);
      const client = new Go2rtcClient(config);
      const registration = this.registry.register(source, () => void this.stop());
      const active: ActiveIntercom = { token: registration.token, source, client };
      this.active = active;

      try {
        const endpoint = await this.ingressEndpoint(registration.token);
        await client.play(endpoint);
        await waitWithTimeout(registration.connected, 8000, 'go2rtc did not connect to the Scrypted intercom ingress');
        void source.done.catch(() => undefined).finally(() => {
          if (this.active === active)
            void this.stop();
        });
      }
      catch (error) {
        await this.stopActive();
        throw error;
      }
    });
  }

  stop(): Promise<void> {
    return this.serialized(() => this.stopActive());
  }

  private async ingressEndpoint(token: string): Promise<string> {
    const base = await this.endpointManager.getLocalEndpoint(undefined, {
      public: true,
      insecure: true,
    });
    return `${base.replace(/\/+$/, '')}/intercom/${token}.wav`;
  }

  private async stopActive(): Promise<void> {
    const active = this.active;
    this.active = undefined;
    if (!active)
      return;
    this.registry.remove(active.token);
    await Promise.allSettled([
      active.client.stop(),
      active.source.stop(),
    ]);
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation);
    this.operation = next.catch(() => undefined);
    return next;
  }
}

async function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  }
  finally {
    if (timer)
      clearTimeout(timer);
  }
}
