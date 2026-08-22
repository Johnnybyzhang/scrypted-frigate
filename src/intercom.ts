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
import type { Go2rtcConfig, TalkbackTargetCodec } from './types';
import { Go2rtcClient } from './go2rtc-client';

export type { TalkbackTargetCodec } from './types';

export interface IntercomAudioSource {
  readonly done: Promise<void>;
  readonly codec: TalkbackTargetCodec;
  readonly contentType: string;
  readonly extension: string;
  stream(): AsyncGenerator<Buffer, void>;
  stop(): Promise<void>;
}

export interface IntercomAudioSourceFactory {
  create(media: MediaObject, targetCodec?: TalkbackTargetCodec): Promise<IntercomAudioSource>;
}

export function intercomFfmpegArguments(input: FFmpegInput, codec: TalkbackTargetCodec): string[] {
  const inputArguments = input.inputArguments?.length
    ? [...input.inputArguments]
    : input.url
      ? ['-i', input.url]
      : [];
  if (!inputArguments.length)
    throw new Error('Scrypted intercom media did not provide FFmpeg input arguments');
  const common = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-probesize', '32',
    '-analyzeduration', '0',
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    ...inputArguments,
    '-map', '0:a:0',
    '-vn',
  ];
  if (codec === 'pcma') {
    return [
      ...common,
      '-acodec', 'pcm_alaw',
      '-ar', '8000',
      '-ac', '1',
      '-flush_packets', '1',
      '-f', 'wav',
      'pipe:1',
    ];
  }
  return [
    ...common,
    '-acodec', 'libopus',
    '-application:a', 'lowdelay',
    '-frame_duration', '10',
    '-ar', '48000',
    '-ac', '2',
    '-b:a', '32k',
    '-flush_packets', '1',
    '-mpegts_flags', 'resend_headers',
    '-muxdelay', '0',
    '-muxpreload', '0',
    '-f', 'mpegts',
    'pipe:1',
  ];
}

export type FfmpegEncoderProbe = (ffmpegPath: string) => Promise<Set<string>>;

export const probeFfmpegEncoders: FfmpegEncoderProbe = ffmpegPath => new Promise((resolve, reject) => {
  childProcess.execFile(ffmpegPath, ['-hide_banner', '-encoders'], {
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
  }, (error, stdout, stderr) => {
    if (error) {
      reject(error);
      return;
    }
    const encoders = new Set<string>();
    for (const match of `${stdout}\n${stderr}`.matchAll(/^\s*[A-Z.]{6}\s+(\S+)/gm)) {
      if (match[1])
        encoders.add(match[1]);
    }
    resolve(encoders);
  });
});

export class ScryptedFfmpegAudioSourceFactory implements IntercomAudioSourceFactory {
  private encoderCache?: { path: string; encoders: Promise<Set<string>> };

  constructor(
    private readonly mediaManager: MediaManager,
    private readonly encoderProbe: FfmpegEncoderProbe = probeFfmpegEncoders,
  ) {}

  async create(media: MediaObject, targetCodec: TalkbackTargetCodec = 'pcma'): Promise<IntercomAudioSource> {
    const inputBuffer = await waitWithTimeout(
      this.mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput),
      10_000,
      'Scrypted intercom media conversion timed out',
    );
    const input = JSON.parse(inputBuffer.toString()) as FFmpegInput;
    const args = intercomFfmpegArguments(input, targetCodec);
    const ffmpegPath = input.ffmpegPath || await waitWithTimeout(
      this.mediaManager.getFFmpegPath(),
      5000,
      'Scrypted FFmpeg path lookup timed out',
    );
    if (targetCodec === 'opus') {
      const encoders = await this.encoders(ffmpegPath);
      if (!encoders.has('libopus'))
        throw new Error('Scrypted FFmpeg is missing the libopus encoder required for the Opus talkback target');
    }
    const process = childProcess.spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: input.env ? { ...processEnv(), ...input.env } : processEnv(),
    });
    return new FfmpegAudioSource(process, targetCodec);
  }

  private encoders(ffmpegPath: string): Promise<Set<string>> {
    if (!this.encoderCache || this.encoderCache.path !== ffmpegPath)
      this.encoderCache = { path: ffmpegPath, encoders: this.encoderProbe(ffmpegPath) };
    return this.encoderCache.encoders;
  }
}

function processEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

class FfmpegAudioSource implements IntercomAudioSource {
  readonly done: Promise<void>;
  readonly contentType: string;
  readonly extension: string;
  private stopped = false;

  constructor(
    private readonly process: ChildProcess,
    readonly codec: TalkbackTargetCodec,
  ) {
    this.contentType = codec === 'pcma' ? 'audio/wav' : 'video/mp2t';
    this.extension = codec === 'pcma' ? 'wav' : 'ts';
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
    const requested = this.tokenFromRequest(request.url || '');
    const entry = requested ? this.entries.get(requested.token) : undefined;
    if (!entry || entry.source.extension !== requested?.extension) {
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
        'Content-Type': entry.source.contentType,
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

  private tokenFromRequest(rawUrl: string): { token: string; extension: string } | undefined {
    try {
      const url = new URL(rawUrl, 'http://scrypted.invalid');
      const filename = url.pathname.split('/').filter(Boolean).at(-1);
      const match = filename?.match(/^([a-f0-9]{48})\.(wav|ts)$/);
      if (!match?.[1] || !match[2])
        return undefined;
      return { token: match[1], extension: match[2] };
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
      let pcmaError: unknown;
      try {
        await this.startTarget(media, config, 'pcma');
        return;
      }
      catch (error) {
        pcmaError = error;
        await this.stopActive();
      }
      try {
        await this.startTarget(media, config, 'opus');
      }
      catch (opusError) {
        await this.stopActive();
        throw new AggregateError(
          [pcmaError, opusError],
          'Talkback failed with both the PCMA and Opus camera targets',
        );
      }
    });
  }

  stop(): Promise<void> {
    return this.serialized(() => this.stopActive());
  }

  private async startTarget(
    media: MediaObject,
    config: Go2rtcConfig,
    codec: TalkbackTargetCodec,
  ): Promise<void> {
    const source = await this.sourceFactory.create(media, codec);
    const client = new Go2rtcClient(config);
    const registration = this.registry.register(source, () => void this.stop());
    const active: ActiveIntercom = { token: registration.token, source, client };
    this.active = active;
    const endpoint = await this.ingressEndpoint(registration.token, source.extension);
    await client.play(endpoint, codec);
    await waitWithTimeout(registration.connected, 8000, 'go2rtc did not connect to the Scrypted intercom ingress');
    void source.done.catch(() => undefined).finally(() => {
      if (this.active === active)
        void this.stop();
    });
  }

  private async ingressEndpoint(token: string, extension: string): Promise<string> {
    const base = await this.endpointManager.getLocalEndpoint(undefined, {
      public: true,
      insecure: true,
    });
    return `${base.replace(/\/+$/, '')}/intercom/${token}.${extension}`;
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
