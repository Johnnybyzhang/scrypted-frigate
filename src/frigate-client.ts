import type { MediaManager, MediaObject } from '@scrypted/sdk';
import type {
  DiscoveredCamera,
  DiscoveredStream,
  FrigateDiscoveryResult,
  ProviderConfig,
} from './types';
import { authorizationHeaders, fetchWithTimeout, HttpStatusError } from './http';

interface FrigateInputConfig {
  path?: unknown;
  roles?: unknown;
}

interface FrigateCameraConfig {
  enabled?: unknown;
  audio?: { enabled?: unknown };
  detect?: { width?: unknown; height?: unknown };
  ffmpeg?: { inputs?: unknown };
  live?: { streams?: unknown };
}

interface FrigateConfigResponse {
  cameras?: unknown;
  mqtt?: { topic_prefix?: unknown };
}

interface StreamMetadata {
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioSampleRate?: number;
}

interface VideoMetadata {
  codec?: string;
  height?: number;
  width?: number;
}

interface AudioMetadata {
  codec?: string;
  sampleRate?: number;
}

export class FrigateClient {
  constructor(
    private readonly config: ProviderConfig,
    private readonly mediaManager: MediaManager,
  ) {}

  private headers(): Record<string, string> {
    return authorizationHeaders({ bearerToken: this.config.frigateApiToken });
  }

  private apiUrl(path: string): string {
    if (!this.config.frigateBaseUrl)
      throw new Error('Frigate API URL is required');
    return `${this.config.frigateBaseUrl}/api/${path.replace(/^\/+/, '')}`;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.config.frigateBaseUrl)
      return false;
    try {
      const response = await fetchWithTimeout(this.apiUrl('version'), { headers: this.headers() }, 5000);
      return response.ok;
    }
    catch {
      return false;
    }
  }

  async discoverCameras(): Promise<FrigateDiscoveryResult> {
    const [frigateConfigResult, go2rtcStreamsResult] = await Promise.allSettled([
      this.getJson<FrigateConfigResponse>('config'),
      this.getJson<Record<string, unknown>>('go2rtc/streams'),
    ]);
    if (frigateConfigResult.status === 'rejected')
      throw frigateConfigResult.reason;
    const frigateConfig = frigateConfigResult.value;
    const go2rtcStreams = go2rtcStreamsResult.status === 'fulfilled'
      ? go2rtcStreamsResult.value
      : {};
    const cameras = isRecord(frigateConfig.cameras) ? frigateConfig.cameras : {};
    const streams = isRecord(go2rtcStreams) ? go2rtcStreams : {};
    const discovered: DiscoveredCamera[] = [];
    for (const [cameraName, value] of Object.entries(cameras)) {
      const camera = isRecord(value) ? value as FrigateCameraConfig : {};
      discovered.push(this.discoverCamera(cameraName, camera, streams));
    }
    const configuredPrefix = typeof frigateConfig.mqtt?.topic_prefix === 'string'
      ? frigateConfig.mqtt.topic_prefix.trim()
      : '';
    return {
      cameras: discovered.sort((left, right) => left.cameraName.localeCompare(right.cameraName)),
      topicPrefix: configuredPrefix || 'frigate',
      warning: go2rtcStreamsResult.status === 'rejected'
        ? `go2rtc stream metadata unavailable: ${errorMessage(go2rtcStreamsResult.reason)}`
        : undefined,
    };
  }

  async takePicture(cameraName: string): Promise<MediaObject> {
    const response = await fetchWithTimeout(this.apiUrl(`${encodeURIComponent(cameraName)}/latest.jpg`), {
      headers: {
        Accept: 'image/jpeg,image/webp;q=0.9,*/*;q=0.1',
        ...this.headers(),
      },
    }, 10_000);
    if (!response.ok)
      throw new HttpStatusError(`Frigate snapshot failed with HTTP ${response.status}`, response.status);
    const contentType = response.headers.get('content-type')?.split(';', 1)[0] || 'image/jpeg';
    if (!contentType.startsWith('image/'))
      throw new Error(`Frigate snapshot returned unexpected content type ${contentType}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length)
      throw new Error('Frigate snapshot returned an empty response');
    return this.mediaManager.createMediaObject(data, contentType);
  }

  effectiveGo2rtcApiUrl(): string {
    if (this.config.go2rtcApiUrl)
      return this.config.go2rtcApiUrl;
    if (!this.config.frigateBaseUrl)
      return '';
    const frigate = new URL(this.config.frigateBaseUrl);
    return `http://${hostForUrl(frigate.hostname)}:1984`;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await fetchWithTimeout(this.apiUrl(path), { headers: this.headers() }, 10_000);
    if (!response.ok)
      throw new HttpStatusError(`Frigate ${path} failed with HTTP ${response.status}`, response.status);
    return await response.json() as T;
  }

  private discoverCamera(
    cameraName: string,
    camera: FrigateCameraConfig,
    go2rtcStreams: Record<string, unknown>,
  ): DiscoveredCamera {
    const friendlyStreams = liveStreams(camera.live?.streams);
    const roles = roleStreams(camera.ffmpeg?.inputs);
    const configuredCandidates = unique([
      ...friendlyStreams.map(stream => stream.id),
      ...roles.main,
      ...roles.sub,
    ]);
    const apiCandidates = unique([...configuredCandidates, cameraName])
      .filter(name => name in go2rtcStreams);
    const candidates = unique([...configuredCandidates, ...apiCandidates]);
    const restreamAvailable = candidates.length > 0;
    const fallbackName = candidates[0] || cameraName;
    const streamCandidates = (candidates.length ? candidates : [fallbackName]).map((id, index) => {
      const metadata = streamMetadata(go2rtcStreams[id]);
      const friendly = friendlyStreams.find(stream => stream.id === id)?.name;
      return this.stream(id, friendly || (index ? `Stream ${index + 1}` : 'Main Stream'), metadata);
    });
    const sorted = [...streamCandidates].sort((left, right) => streamPixels(right) - streamPixels(left));
    const roleMain = sorted.find(stream => roles.main.includes(stream.id));
    const roleSub = [...sorted].reverse().find(stream => roles.sub.includes(stream.id));
    const mainStream = roleMain || sorted[0];
    if (!mainStream)
      throw new Error(`Frigate camera ${cameraName} did not produce a stream candidate`);
    let subStream = roleSub || (sorted.length > 1 ? sorted.at(-1) : undefined);
    if (subStream?.id === mainStream.id)
      subStream = undefined;

    const detectWidth = finitePositive(camera.detect?.width);
    const detectHeight = finitePositive(camera.detect?.height);
    mainStream.width ||= 1920;
    mainStream.height ||= 1080;
    if (subStream) {
      subStream.width ||= detectWidth || 640;
      subStream.height ||= detectHeight || 360;
    }
    return {
      cameraName,
      enabled: camera.enabled !== false,
      restreamAvailable,
      audioDetection: camera.audio?.enabled === true,
      mainStream,
      subStream,
    };
  }

  private stream(id: string, name: string, metadata: StreamMetadata): DiscoveredStream {
    return {
      id,
      name,
      rtspUrl: this.streamRtspUrl(id),
      ...metadata,
      videoCodec: 'h264',
    };
  }

  private streamRtspUrl(id: string): string {
    const url = `${this.rtspBaseUrl()}/${encodeURIComponent(id)}`;
    return `${url}?video=h264&audio`;
  }

  private rtspBaseUrl(): string {
    if (this.config.rtspRestreamBaseUrl)
      return this.config.rtspRestreamBaseUrl;
    const frigate = new URL(this.config.frigateBaseUrl);
    return `rtsp://${hostForUrl(frigate.hostname)}:8554`;
  }
}

function liveStreams(value: unknown): Array<{ name: string; id: string }> {
  if (!isRecord(value))
    return [];
  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()))
    .map(([name, id]) => ({ name, id: id.trim() }));
}

function roleStreams(value: unknown): { main: string[]; sub: string[] } {
  if (!Array.isArray(value))
    return { main: [], sub: [] };
  const main: string[] = [];
  const sub: string[] = [];
  for (const raw of value) {
    if (!isRecord(raw))
      continue;
    const input = raw as FrigateInputConfig;
    if (typeof input.path !== 'string' || !Array.isArray(input.roles))
      continue;
    const streamName = restreamName(input.path);
    if (!streamName)
      continue;
    const roles = input.roles.filter((role): role is string => typeof role === 'string');
    if (roles.includes('record'))
      main.push(streamName);
    if (roles.includes('detect'))
      sub.push(streamName);
  }
  return { main: unique(main), sub: unique(sub) };
}

function restreamName(path: string): string | undefined {
  try {
    const url = new URL(path);
    if (url.protocol !== 'rtsp:' || url.port !== '8554')
      return undefined;
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname))
      return undefined;
    return decodeURIComponent(url.pathname.replace(/^\/+/, '')) || undefined;
  }
  catch {
    return undefined;
  }
}

function streamMetadata(value: unknown): StreamMetadata {
  const videos: VideoMetadata[] = [];
  const audios: AudioMetadata[] = [];
  for (const codec of receiverCodecs(value)) {
    const codecType = typeof codec.codec_type === 'string' ? codec.codec_type : '';
    const codecName = typeof codec.codec_name === 'string' ? codec.codec_name.toLowerCase() : '';
    if (codecType === 'video' || (!codecType && finitePositive(codec.width) && finitePositive(codec.height))) {
      videos.push({
        codec: normalizeVideoCodec(codecName),
        height: finitePositive(codec.height),
        width: finitePositive(codec.width),
      });
    }
    if (codecType === 'audio' || (!codecType && finitePositive(codec.sample_rate))) {
      audios.push({
        codec: codecName || undefined,
        sampleRate: finitePositive(codec.sample_rate),
      });
    }
  }
  const video = videos.find(candidate => candidate.codec === 'h264') || videos[0];
  const audio = audios[0];
  return {
    width: video?.width,
    height: video?.height,
    videoCodec: video?.codec,
    audioCodec: audio?.codec,
    audioSampleRate: audio?.sampleRate,
  };
}

function receiverCodecs(value: unknown): Record<string, unknown>[] {
  if (isRecord(value) && Array.isArray(value.producers)) {
    const codecs: Record<string, unknown>[] = [];
    for (const producer of value.producers) {
      if (!isRecord(producer) || !Array.isArray(producer.receivers))
        continue;
      for (const receiver of producer.receivers) {
        if (!isRecord(receiver))
          continue;
        const codec = isRecord(receiver.codec) ? receiver.codec : receiver;
        codecs.push(codec);
      }
    }
    return codecs;
  }

  const codecs: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();
  walk(value, current => {
    const codec = isRecord(current.codec) ? current.codec : current;
    if (seen.has(codec))
      return;
    seen.add(codec);
    if (typeof codec.codec_type === 'string'
      || finitePositive(codec.width)
      || finitePositive(codec.height)
      || finitePositive(codec.sample_rate))
      codecs.push(codec);
  });
  return codecs;
}

function normalizeVideoCodec(codec: string): string | undefined {
  if (!codec)
    return undefined;
  if (['avc', 'avc1', 'h.264', 'h264'].includes(codec))
    return 'h264';
  if (['h.265', 'h265', 'hevc', 'hev1'].includes(codec))
    return 'h265';
  return codec;
}

function walk(value: unknown, visitor: (value: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach(item => walk(item, visitor));
    return;
  }
  if (!isRecord(value))
    return;
  visitor(value);
  Object.values(value).forEach(item => walk(item, visitor));
}

function streamPixels(stream: DiscoveredStream): number {
  return (stream.width || 0) * (stream.height || 0);
}

function finitePositive(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : undefined;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hostForUrl(hostname: string): string {
  return hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
