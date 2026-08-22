import type { EndpointManager, HttpResponse, MediaObject } from '@scrypted/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Go2rtcIntercom,
  IntercomIngressRegistry,
  ScryptedFfmpegAudioSourceFactory,
  type IntercomAudioSource,
  type IntercomAudioSourceFactory,
} from '../src/intercom';
import { Go2rtcClient } from '../src/go2rtc-client';
import { go2rtcConfig } from './fixtures';

class TestAudioSource implements IntercomAudioSource {
  readonly done = new Promise<void>(() => undefined);
  stopped = false;

  async *stream(): AsyncGenerator<Buffer, void> {
    yield Buffer.from('RIFF-test');
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

function responseCapture(): { response: HttpResponse; getStream: () => AsyncGenerator<Buffer, void> | undefined } {
  let stream: AsyncGenerator<Buffer, void> | undefined;
  return {
    response: {
      send: vi.fn(),
      sendFile: vi.fn(),
      sendSocket: vi.fn(),
      sendStream: value => {
        stream = value;
      },
    },
    getStream: () => stream,
  };
}

describe('IntercomIngressRegistry', () => {
  it('serves each random ingress token once', async () => {
    const registry = new IntercomIngressRegistry();
    const source = new TestAudioSource();
    const registration = registry.register(source, vi.fn());
    const first = responseCapture();

    await registry.onRequest({ url: `/endpoint/plugin/intercom/${registration.token}.wav` }, first.response);
    await expect(registration.connected).resolves.toBeUndefined();
    expect(first.getStream()).toBeDefined();
    const chunk = await first.getStream()!.next();
    expect(chunk.value?.toString()).toBe('RIFF-test');

    const second = responseCapture();
    await registry.onRequest({ url: `/intercom/${registration.token}.wav` }, second.response);
    expect(second.response.send).toHaveBeenCalledWith(
      'Intercom ingress is already connected',
      expect.objectContaining({ code: 409 }),
    );
  });

  it('rejects unknown tokens', async () => {
    const registry = new IntercomIngressRegistry();
    const capture = responseCapture();
    await registry.onRequest({ url: `/intercom/${'0'.repeat(48)}.wav` }, capture.response);
    expect(capture.response.send).toHaveBeenCalledWith('Not found', expect.objectContaining({ code: 404 }));
  });
});

describe('ScryptedFfmpegAudioSourceFactory', () => {
  it('rejects malformed FFmpeg input before spawning', async () => {
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

  it('starts and stops stream-to-camera playback through the documented API', async () => {
    const requests: URL[] = [];
    globalThis.fetch = vi.fn(async input => {
      requests.push(new URL(String(input)));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const client = new Go2rtcClient(go2rtcConfig());

    await client.play('http://scrypted.invalid/intercom/token.wav');
    await client.stop();

    expect(requests).toHaveLength(2);
    expect(requests[0]?.pathname).toBe('/api/streams');
    expect(requests[0]?.searchParams.get('dst')).toBe('front_door');
    expect(requests[0]?.searchParams.get('src')).toBe('ffmpeg:http://scrypted.invalid/intercom/token.wav#audio=pcma');
    expect(requests[1]?.searchParams.get('src')).toBe('');
  });
});

describe('Go2rtcIntercom', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('coordinates source, Scrypted ingress and go2rtc without host paths', async () => {
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
        const ingressUrl = src.slice('ffmpeg:'.length, src.indexOf('#audio=pcma'));
        await registry.onRequest({ url: ingressUrl }, responseCapture().response);
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await intercom.start({} as MediaObject, go2rtcConfig());
    expect(endpointManager.getLocalEndpoint).toHaveBeenCalledWith(undefined, { public: true, insecure: true });
    expect(requests[0]?.searchParams.get('src')).toMatch(/^ffmpeg:http:\/\/scrypted\.invalid\/endpoint\/plugin\/intercom\/[a-f0-9]{48}\.wav#audio=pcma$/);

    await intercom.stop();
    expect(source.stopped).toBe(true);
    expect(requests.at(-1)?.searchParams.get('src')).toBe('');
  });
});
