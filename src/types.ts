import type { ScryptedDeviceType } from '@scrypted/sdk';

export const CAMERA_NATIVE_ID_PREFIX = 'frigate-camera:';

export interface ProviderConfig {
  frigateBaseUrl: string;
  frigateApiToken: string;
  rtspRestreamBaseUrl: string;
  mqttUrl: string;
  mqttUsername: string;
  mqttPassword: string;
  go2rtcApiUrl: string;
  go2rtcApiUsername: string;
  go2rtcApiPassword: string;
  importedCameras: string[];
}

export interface CameraConfig {
  deviceName: string;
  deviceType: ScryptedDeviceType | string;
  enableIntercom: boolean;
  deviceAvailabilityTopic: string;
  doorbellTopic: string;
  tamperTopic: string;
  doorbellPulseMs: number;
  tamperPulseMs: number;
}

export interface DiscoveredStream {
  id: string;
  name: string;
  rtspUrl: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioSampleRate?: number;
}

export interface DiscoveredCamera {
  cameraName: string;
  enabled: boolean;
  restreamAvailable: boolean;
  audioDetection: boolean;
  mainStream: DiscoveredStream;
  subStream?: DiscoveredStream;
}

export interface FrigateDiscoveryResult {
  cameras: DiscoveredCamera[];
  topicPrefix: string;
  warning?: string;
}

export interface Go2rtcConfig {
  apiUrl: string;
  apiUsername: string;
  apiPassword: string;
  streamName: string;
}

export type TalkbackTargetCodec = 'pcma' | 'opus';

export interface CameraStateSink {
  setMotion(active: boolean): void;
  setAudio(active: boolean): void;
  pulseDoorbell(eventKey?: string): void;
  pulseTamper(eventKey?: string): void;
  setFrigateAvailable(available: boolean): void;
  setDeviceAvailable(available: boolean): void;
  setMqttConnected(connected: boolean): void;
}

export interface HttpCredentials {
  username?: string;
  password?: string;
  bearerToken?: string;
}

export function cameraNativeId(cameraName: string): string {
  return `${CAMERA_NATIVE_ID_PREFIX}${encodeURIComponent(cameraName)}`;
}

export function cameraNameFromNativeId(nativeId: string): string | undefined {
  if (!nativeId.startsWith(CAMERA_NATIVE_ID_PREFIX))
    return undefined;
  try {
    return decodeURIComponent(nativeId.slice(CAMERA_NATIVE_ID_PREFIX.length));
  }
  catch {
    return undefined;
  }
}
