import type { EndpointManager, HttpResponse, MediaObject } from '@scrypted/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Go2rtcIntercom,
  IntercomIngressRegistry,
  ScryptedFfmpegAudioSourceFactory,
  intercomFfmpegArguments,
  type IntercomAudioSource,
  type IntercomAudioSourceFactory,
  type TalkbackTargetCodec,
} from '../src/intercom';
import { Go2rtcClient } from '../src/go2rtc-client';
import { go2rtcConfig } from './fixtures';

class TestAudioSource implements IntercomAudioSource {
  readonly done = new Promise<void>(() => undefined);
  readonly contentType: string;
  readonly extension: string;
  stopped = false;

  constructor(
    readonly codec: TalkbackTargetCodec = 'pcma',
    private readonly payload = 'RIFF-test',
  ) {
    this.contentType = codec === 'pcma' ? 'audio/wav' : 'video/mp2t';
    this.extension = codec === 'pcma' ? 'wav' : 'ts';
  }

  async *stream(): AsyncGenerator<Buffer, void> {
    yield Buffer.from(this.payload);
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

function responseCapture(): {
  response: HttpResponse;
  getStream: () => AsyncGenerator<Buffer, void> | undefined;
  getHeaders: () => Record<string, string> | undefined;
} {
  let stream: AsyncGenerator<Buffer, void> | undefined;
  let headers: Record<string, string> | undefined;
  return {
    response: {
      send: vi.fn(),
      sendFile: vi.fn(),
      sendSocket: vi.fn(),
      sendStream: (value, options) => {
        stream = value;
        headers = options?.headers as Record<string, string> | undefined;
      },
    },
    getStream: () => stream,
    getHeaders: () => headers,
  };
}

describe('IntercomIngressRegistry', () => {
  it('serves each random PCMA ingress token once', async () => {
    const registry = new IntercomIngressRegistry();
    const source = new TestAudioSource();
    const registration = registry.register(source, vi.fn());
    const first = responseCapture();

    await registry.onRequest({ url: `/endpoint/plugin/intercom/${registration.token}.wav` }, first.response);
    await expect(registration.connected).resolves.toBeUndefined();
    expect(first.getHeaders()?.['Content-Type']).toBe('audio/wav');
    const chunk = await first.getStream()!.next();
    expect(chunk.value?.toString()).toBe('RIFF-test');

    const second = responseCapture();
    await registry.onRequest({ url: `/intercom/${registration.token}.wav` }, second.response);
    expect(second.response.send).toHaveBeenCalledWith(
      'Intercom ingress is already connected',
      expect.objectContaining({ code: 409 }),
    );
  });

  it('serves Opus as MPEG-TS and rejects a mismatched extension', async () => {
    const registry = new IntercomIngressRegistry();
    const source = new TestAudioSource('opus', 'mpegts-test');
    const registration = registry.register(source, vi.fn());
    const wrong = responseCapture();
    await registry.onRequest({ url: `/intercom/${registration.token}.wav` }, wrong.response);
    expect(wrong.response.send).toHaveBeenCalledWith('Not found', expect.objectContaining({ code: 404 }));

    const correct = responseCapture();
    await registry.onRequest({ url: `/intercom/${registration.token}.ts` }, correct.response);
    expect(correct.getHeaders()?.['Content-Type']).toBe('video/mp2t');
  });

  it('rejects unknown tokens', async () => {
    const registry = new IntercomIngressRegistry();
    const capture = responseCapture();
    await registry.onRequest({ url: `/intercom/${'0'.repeat(48)}.wav` }, capture.response);
    expect(capture.response.send).toHaveBeenCalledWith('Not found', expect.objectContaining({ code: 404 }));
  });
});

describe('ScryptedFfmpegAudioSourceFactory', () => {
  it('decodes the HomeKit AAC-ELD input and streams PCMA to go2rtc', () => {
    expect(intercomFfmpegArguments({
      url: 'rtsp://127.0.0.1:12345/talkback',
      inputArguments: ['-acodec', 'libfdk_aac', '-i', 'rtsp://127.0.0.1:12345/talkback'],
    }, 'pcma')).toEqual([
      '-hide_banner',
      '-loglevel', 'warning',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-acodec', 'libfdk_aac',
      '-i', 'rtsp://127.0.0.1:12345/talkback',
      '-map', '0:a:0',
      '-vn',
      '-acodec', 'pcm_alaw',
      '-ar', '8000',
      '-ac', '1',
      '-flush_packets', '1',
      '-f', 'wav',
      'pipe:1',
    ]);
  });

  it('decodes the HomeKit Opus input and streams low-delay Opus to go2rtc', () => {
    expect(intercomFfmpegArguments({
      inputArguments: ['-acodec', 'libopus', '-i', 'rtsp://127.0.0.1:12345/talkback'],
    }, 'opus')).toEqual([
      '-hide_banner',
      '-loglevel', 'warning',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-acodec', 'libopus',
      '-i', 'rtsp://127.0.0.1:12345/talkback',
      '-map', '0:a:0',
      '-vn',
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
    ]);
  });

  it('rejects malformed FFmpeg input before looking up FFmpeg', async () => {
    const mediaManager = {
      convertMediaObjectToBuffer: vi.fn(async () => Buffer.from('{}')),
      getFFmpegPath: vi.fn(async () => '/path/that/must/not/run'),
    };
    const factory = new ScryptedFfmpegAudioSourceFactory(mediaManager as never);
    await expect(factory.create({} as MediaObject)).rejects.toThrow('did not provide FFmpeg input arguments');
    expect(mediaManager.getFFmpegPath).not.toHaveBeenCalled();
  });
});

describe('Go2rtcClient', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('passes the plugin-encoded stream to go2rtc without another FFmpeg layer', async () => {
    const requests: URL[] = [];
    globalThis.fetch = vi.fn(async input => {
      requests.push(new URL(String(input)));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const client = new Go2rtcClient(go2rtcConfig());

    await client.play('http://scrypted.invalid/intercom/token.wav', 'pcma');
    await client.stop();

    expect(requests).toHaveLength(2);
    expect(requests[0]?.pathname).toBe('/api/streams');
    expect(requests[0]?.searchParams.get('dst')).toBe('front_door');
    expect(requests[0]?.searchParams.get('src')).toBe('http://scrypted.invalid/intercom/token.wav');
    expect(requests[1]?.searchParams.get('src')).toBe('');
  });

  it('asks go2rtc to remux the plugin-encoded Opus stream without transcoding it', async () => {
    const requests: URL[] = [];
    globalThis.fetch = vi.fn(async input => {
      requests.push(new URL(String(input)));
      return new Response('', { status: 200 });
    }) as typeof fetch;
    const client = new Go2rtcClient(go2rtcConfig());

    await client.play('http://scrypted.invalid/intercom/token.ts', 'opus');

    expect(requests[0]?.searchParams.get('src')).toBe(
      'ffmpeg:http://scrypted.invalid/intercom/token.ts#audio=copy#input=-probesize%2032%20-analyzeduration%200%20-fflags%20nobuffer%20-flags%20low_delay%20-i%20%7Binput%7D',
    );
  });
});

describe('Go2rtcIntercom', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('coordinates a PCMA target through Scrypted ingress and go2rtc', async () => {
    const registry = new IntercomIngressRegistry();
    const source = new TestAudioSource();
    const factory: IntercomAudioSourceFactory = { create: vi.fn(async () => source) };
    const endpointManager = {
      getLocalEndpoint: vi.fn(async () => 'http://scrypted.invalid/endpoint/plugin'),
    } as unknown as EndpointManager;
    const intercom = new Go2rtcIntercom(registry, factory, endpointManager);
    const requests: URL[] = [];

    globalThis.fetch = vi.fn(async input => {
      const requestUrl = new URL(String(input));
      requests.push(requestUrl);
      const src = requestUrl.searchParams.get('src') || '';
      if (src) {
        const ingressUrl = src.startsWith('ffmpeg:')
          ? src.slice('ffmpeg:'.length, src.indexOf('#'))
          : src;
        await registry.onRequest({ url: ingressUrl }, responseCapture().response);
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await intercom.start({} as MediaObject, go2rtcConfig());
    expect(factory.create).toHaveBeenCalledWith(expect.anything(), 'pcma');
    expect(endpointManager.getLocalEndpoint).toHaveBeenCalledWith(undefined, { public: true, insecure: true });
    expect(requests[0]?.searchParams.get('src')).toMatch(
      /^http:\/\/scrypted\.invalid\/endpoint\/plugin\/intercom\/[a-f0-9]{48}\.wav$/,
    );

    await intercom.stop();
    expect(source.stopped).toBe(true);
    expect(requests.at(-1)?.searchParams.get('src')).toBe('');
  });

  it('retries with an Opus target when go2rtc rejects PCMA', async () => {
    const registry = new IntercomIngressRegistry();
    const pcma = new TestAudioSource('pcma');
    const opus = new TestAudioSource('opus', 'mpegts-test');
    const factory: IntercomAudioSourceFactory = {
      create: vi.fn(async (_media, codec) => codec === 'opus' ? opus : pcma),
    };
    const endpointManager = {
      getLocalEndpoint: vi.fn(async () => 'http://scrypted.invalid/endpoint/plugin'),
    } as unknown as EndpointManager;
    const intercom = new Go2rtcIntercom(registry, factory, endpointManager);
    const requests: URL[] = [];
    let nonEmptyRequests = 0;

    globalThis.fetch = vi.fn(async input => {
      const requestUrl = new URL(String(input));
      requests.push(requestUrl);
      const src = requestUrl.searchParams.get('src') || '';
      if (!src)
        return new Response('', { status: 200 });
      nonEmptyRequests += 1;
      if (nonEmptyRequests === 1)
        return new Response('no matching camera backchannel', { status: 500 });
      const ingressUrl = src.startsWith('ffmpeg:')
        ? src.slice('ffmpeg:'.length, src.indexOf('#'))
        : src;
      await registry.onRequest({ url: ingressUrl }, responseCapture().response);
      return new Response('', { status: 200 });
    }) as typeof fetch;

    await intercom.start({} as MediaObject, go2rtcConfig());

    expect(factory.create).toHaveBeenNthCalledWith(1, expect.anything(), 'pcma');
    expect(factory.create).toHaveBeenNthCalledWith(2, expect.anything(), 'opus');
    expect(pcma.stopped).toBe(true);
    expect(requests.find(request => request.searchParams.get('src')?.includes('.ts#audio=copy#input='))).toBeDefined();

    await intercom.stop();
    expect(opus.stopped).toBe(true);
  });
});
