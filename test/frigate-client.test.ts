import type { MediaManager, MediaObject } from '@scrypted/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrigateClient } from '../src/frigate-client';
import { providerConfig } from './fixtures';

describe('FrigateClient', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('checks the authenticated Frigate version endpoint', async () => {
    const requests: Array<{ url: string; authorization?: string }> = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization') || undefined,
      });
      return new Response('0.17.2', { status: 200 });
    }) as typeof fetch;
    const client = new FrigateClient(
      providerConfig({ frigateApiToken: 'token' }),
      {} as MediaManager,
    );

    await expect(client.isHealthy()).resolves.toBe(true);
    expect(requests).toEqual([{
      url: 'https://frigate.invalid:8971/api/version',
      authorization: 'Bearer token',
    }]);
  });

  it('discovers all Frigate cameras and resolves configured go2rtc streams', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = new URL(String(input));
      if (url.pathname === '/api/config') {
        return Response.json({
          mqtt: { topic_prefix: 'site-frigate' },
          cameras: {
            front_door: {
              enabled: true,
              audio: { enabled: true },
              detect: { width: 640, height: 360 },
              live: { streams: { 'Main Stream': 'front_door', 'Low Resolution Stream': 'front_door_sub' } },
              ffmpeg: {
                inputs: [
                  { path: 'rtsp://127.0.0.1:8554/front_door', roles: ['record'] },
                  { path: 'rtsp://127.0.0.1:8554/front_door_sub', roles: ['detect'] },
                ],
              },
            },
            side_yard: {
              enabled: true,
              audio: { enabled: false },
              live: { streams: { Default: 'side_yard' } },
            },
          },
        });
      }
      if (url.pathname === '/api/go2rtc/streams') {
        return Response.json({
          front_door: streamInfo('h264', 1920, 1080, 'aac', 16000),
          front_door_sub: streamInfo('h264', 640, 360),
          side_yard: streamInfo('h264', 1280, 720),
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const client = new FrigateClient(providerConfig(), {} as MediaManager);

    const result = await client.discoverCameras();

    expect(result.topicPrefix).toBe('site-frigate');
    expect(result.cameras.map(camera => camera.cameraName)).toEqual(['front_door', 'side_yard']);
    expect(result.cameras[0]).toMatchObject({
      audioDetection: true,
      restreamAvailable: true,
      mainStream: {
        id: 'front_door',
        rtspUrl: 'rtsp://frigate.invalid:8554/front_door?video=h264&audio',
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        audioSampleRate: 16000,
      },
      subStream: {
        id: 'front_door_sub',
        width: 640,
        height: 360,
      },
    });
    expect(result.cameras[1]).toMatchObject({
      audioDetection: false,
      mainStream: { id: 'side_yard', width: 1280, height: 720 },
      subStream: undefined,
    });
  });

  it('selects an H.264 producer when HEVC appears first in one go2rtc stream', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = new URL(String(input));
      if (url.pathname === '/api/config') {
        return Response.json({
          cameras: {
            camera_1: {
              live: { streams: { Default: 'Camera-1' } },
            },
          },
        });
      }
      if (url.pathname === '/api/go2rtc/streams') {
        return Response.json({
          'Camera-1': {
            producers: [
              {
                url: 'onvif://onvif:pass@camera.invalid?subtype=Profile_1',
                receivers: [
                  { codec: { codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160 } },
                  { codec: { codec_type: 'audio', codec_name: 'aac', sample_rate: 16000 } },
                ],
              },
              {
                url: 'isapi://user:pass@camera.invalid:80/',
                senders: [{ codec: { codec_type: 'audio', codec_name: 'pcm_alaw', sample_rate: 8000 } }],
              },
              {
                url: 'ffmpeg:Camera-1#video=h264/cuda',
                receivers: [
                  { codec: { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 } },
                ],
              },
            ],
          },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const client = new FrigateClient(providerConfig(), {} as MediaManager);

    const result = await client.discoverCameras();

    expect(result.cameras[0]?.mainStream).toMatchObject({
      id: 'Camera-1',
      rtspUrl: 'rtsp://frigate.invalid:8554/Camera-1?video=h264&audio',
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioSampleRate: 16000,
    });
  });

  it('forces H.264 while the configured transcoder has no receiver metadata yet', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = new URL(String(input));
      if (url.pathname === '/api/config') {
        return Response.json({
          cameras: {
            camera_1: {
              live: { streams: { Default: 'Camera-1' } },
            },
          },
        });
      }
      if (url.pathname === '/api/go2rtc/streams') {
        return Response.json({
          'Camera-1': {
            producers: [
              {
                url: 'onvif://onvif:pass@camera.invalid?subtype=Profile_1',
                receivers: [
                  { codec: { codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160 } },
                  { codec: { codec_type: 'audio', codec_name: 'aac', sample_rate: 16000 } },
                ],
              },
              {
                url: 'ffmpeg:Camera-1#video=h264/cuda',
              },
            ],
          },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const client = new FrigateClient(providerConfig(), {} as MediaManager);

    const result = await client.discoverCameras();

    expect(result.cameras[0]?.mainStream).toMatchObject({
      id: 'Camera-1',
      rtspUrl: 'rtsp://frigate.invalid:8554/Camera-1?video=h264&audio',
      width: 3840,
      height: 2160,
      videoCodec: 'h264',
      audioCodec: 'aac',
    });
  });

  it('keeps cameras discoverable when no go2rtc restream exists', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = new URL(String(input));
      if (url.pathname === '/api/config')
        return Response.json({ cameras: { garage: { enabled: true } } });
      return Response.json({});
    }) as typeof fetch;
    const client = new FrigateClient(providerConfig(), {} as MediaManager);

    const result = await client.discoverCameras();
    expect(result.cameras[0]).toMatchObject({
      cameraName: 'garage',
      restreamAvailable: false,
      mainStream: { id: 'garage' },
    });
  });

  it('keeps configured lazy restreams available when the go2rtc inventory is empty', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = new URL(String(input));
      if (url.pathname === '/api/config') {
        return Response.json({
          cameras: {
            camera_1: {
              live: { streams: { Default: 'Camera-1' } },
            },
          },
        });
      }
      return Response.json({});
    }) as typeof fetch;
    const client = new FrigateClient(providerConfig(), {} as MediaManager);

    const result = await client.discoverCameras();

    expect(result.cameras[0]).toMatchObject({
      cameraName: 'camera_1',
      restreamAvailable: true,
      mainStream: {
        id: 'Camera-1',
        rtspUrl: 'rtsp://frigate.invalid:8554/Camera-1?video=h264&audio',
      },
    });
  });

  it('uses Frigate stream configuration when go2rtc metadata is temporarily unavailable', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = new URL(String(input));
      if (url.pathname === '/api/config') {
        return Response.json({
          cameras: {
            camera_1: {
              live: { streams: { Default: 'Camera-1' } },
            },
          },
        });
      }
      return new Response('temporarily unavailable', { status: 503 });
    }) as typeof fetch;
    const client = new FrigateClient(providerConfig(), {} as MediaManager);

    const result = await client.discoverCameras();

    expect(result.warning).toContain('go2rtc stream metadata unavailable');
    expect(result.cameras[0]).toMatchObject({
      restreamAvailable: true,
      mainStream: { id: 'Camera-1', videoCodec: 'h264' },
    });
  });

  it('returns a Scrypted image from the camera latest-frame endpoint', async () => {
    const requests: string[] = [];
    globalThis.fetch = vi.fn(async input => {
      requests.push(String(input));
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }) as typeof fetch;
    const mediaObject = { mimeType: 'image/jpeg' } as unknown as MediaObject;
    const mediaManager = {
      createMediaObject: vi.fn(async () => mediaObject),
    } as unknown as MediaManager;
    const client = new FrigateClient(providerConfig(), mediaManager);

    await expect(client.takePicture('front_door')).resolves.toBe(mediaObject);
    expect(requests).toEqual(['https://frigate.invalid:8971/api/front_door/latest.jpg']);
    expect(mediaManager.createMediaObject).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg');
  });

  it('rejects non-image snapshot responses', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
    const client = new FrigateClient(providerConfig(), {} as MediaManager);
    await expect(client.takePicture('front_door')).rejects.toThrow('unexpected content type');
  });
});

function streamInfo(videoCodec: string, width: number, height: number, audioCodec?: string, sampleRate?: number) {
  const receivers = [{ codec: { codec_type: 'video', codec_name: videoCodec, width, height } }];
  if (audioCodec)
    receivers.push({ codec: { codec_type: 'audio', codec_name: audioCodec, sample_rate: sampleRate } } as never);
  return { producers: [{ receivers }] };
}
