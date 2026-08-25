import { ScryptedDeviceType } from '@scrypted/sdk';
import type {
  CameraConfig,
  CameraStateSink,
  DiscoveredCamera,
  Go2rtcConfig,
  ProviderConfig,
} from '../src/types';

export function providerConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    frigateBaseUrl: 'https://frigate.invalid:8971',
    frigateApiToken: '',
    rtspRestreamBaseUrl: '',
    mqttUrl: 'mqtt://broker.invalid:1883',
    mqttUsername: '',
    mqttPassword: '',
    go2rtcApiUrl: 'http://go2rtc.invalid:1984',
    go2rtcApiUsername: '',
    go2rtcApiPassword: '',
    importedCameras: ['front_door'],
    ...overrides,
  };
}

export function cameraConfig(overrides: Partial<CameraConfig> = {}): CameraConfig {
  return {
    deviceName: 'Front Door',
    deviceType: ScryptedDeviceType.Doorbell,
    enableIntercom: true,
    deviceAvailabilityTopic: 'site/front_door/availability',
    doorbellTopic: 'site/front_door/doorbell',
    doorbellTriggerRegex: '',
    tamperTopic: 'site/front_door/tamper',
    tamperTriggerRegex: '',
    doorbellPulseMs: 1500,
    tamperPulseMs: 10_000,
    ...overrides,
  };
}

export function discoveredCamera(overrides: Partial<DiscoveredCamera> = {}): DiscoveredCamera {
  return {
    cameraName: 'front_door',
    enabled: true,
    restreamAvailable: true,
    audioDetection: true,
    mainStream: {
      id: 'front_door',
      name: 'Main Stream',
      rtspUrl: 'rtsp://frigate.invalid:8554/front_door?video=h264&audio',
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioSampleRate: 16_000,
    },
    subStream: {
      id: 'front_door_sub',
      name: 'Low Resolution Stream',
      rtspUrl: 'rtsp://frigate.invalid:8554/front_door_sub?video=h264&audio',
      width: 640,
      height: 360,
      videoCodec: 'h264',
    },
    ...overrides,
  };
}

export function go2rtcConfig(overrides: Partial<Go2rtcConfig> = {}): Go2rtcConfig {
  return {
    apiUrl: 'http://go2rtc.invalid:1984',
    apiUsername: '',
    apiPassword: '',
    streamName: 'front_door',
    ...overrides,
  };
}

export interface SinkCalls {
  motion: boolean[];
  audio: boolean[];
  doorbell: Array<string | undefined>;
  tamper: Array<string | undefined>;
  frigateAvailable: boolean[];
  deviceAvailable: boolean[];
  mqttConnected: boolean[];
}

export function cameraSink(): { sink: CameraStateSink; calls: SinkCalls } {
  const calls: SinkCalls = {
    motion: [],
    audio: [],
    doorbell: [],
    tamper: [],
    frigateAvailable: [],
    deviceAvailable: [],
    mqttConnected: [],
  };
  return {
    calls,
    sink: {
      setMotion: value => calls.motion.push(value),
      setAudio: value => calls.audio.push(value),
      pulseDoorbell: key => calls.doorbell.push(key),
      pulseTamper: key => calls.tamper.push(key),
      setFrigateAvailable: value => calls.frigateAvailable.push(value),
      setDeviceAvailable: value => calls.deviceAvailable.push(value),
      setMqttConnected: value => calls.mqttConnected.push(value),
    },
  };
}
