import sdk, {
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  ScryptedMimeTypes,
  type AudioSensor,
  type BinarySensor,
  type Camera,
  type Device,
  type FFmpegInput,
  type Intercom,
  type MediaObject,
  type MotionSensor,
  type Online,
  type RequestMediaStreamOptions,
  type RequestPictureOptions,
  type ResponseMediaStreamOptions,
  type ResponsePictureOptions,
  type Setting,
  type Settings,
  type SettingValue,
  type TamperSensor,
  type VideoCamera,
} from '@scrypted/sdk';
import { cameraSettings, readCameraConfig, storeSetting } from './config';
import { EdgePulse } from './edge-pulse';
import type { CameraConfig, CameraStateSink, DiscoveredCamera } from './types';

const { mediaManager } = sdk;

export interface BridgeProviderHost {
  canIntercom(): boolean;
  cameraConfigurationChanged(camera: FrigateCamera): Promise<void>;
  startIntercom(media: MediaObject, camera: DiscoveredCamera): Promise<void>;
  stopIntercom(): Promise<void>;
  takePicture(cameraName: string): Promise<MediaObject>;
}

export class FrigateCamera extends ScryptedDeviceBase implements
  Camera,
  VideoCamera,
  MotionSensor,
  AudioSensor,
  BinarySensor,
  TamperSensor,
  Intercom,
  Online,
  Settings,
  CameraStateSink {
  private config: CameraConfig;
  private doorbellPulse: EdgePulse;
  private tamperPulse: EdgePulse;
  private lastFrigateAvailability?: boolean;
  private lastDeviceAvailability?: boolean;
  private lastMqttConnected?: boolean;

  constructor(
    private readonly provider: BridgeProviderHost,
    nativeId: string,
    private discovery: DiscoveredCamera,
  ) {
    super(nativeId);
    this.config = readCameraConfig(this.storage, discovery.cameraName);
    this.doorbellPulse = this.createDoorbellPulse();
    this.tamperPulse = this.createTamperPulse();
  }

  get cameraName(): string {
    return this.discovery.cameraName;
  }

  getCameraConfig(): CameraConfig {
    return this.config;
  }

  updateDiscovery(discovery: DiscoveredCamera): void {
    this.discovery = discovery;
  }

  setBridgeOnline(online: boolean): void {
    this.online = online && this.discovery.enabled && this.discovery.restreamAvailable;
  }

  descriptor(): Device {
    const interfaces = [
      ScryptedInterface.Camera,
      ScryptedInterface.MotionSensor,
      ScryptedInterface.Online,
      ScryptedInterface.Settings,
      ScryptedInterface.VideoCamera,
    ];
    if (this.discovery.audioDetection)
      interfaces.push(ScryptedInterface.AudioSensor);
    if (this.config.deviceType === ScryptedDeviceType.Doorbell) {
      interfaces.push(ScryptedInterface.BinarySensor, ScryptedInterface.TamperSensor);
    }
    if (this.config.enableIntercom && this.provider.canIntercom())
      interfaces.push(ScryptedInterface.Intercom);
    return {
      nativeId: this.nativeId,
      name: this.config.deviceName,
      type: this.config.deviceType,
      interfaces,
      info: {
        manufacturer: 'Frigate',
        model: this.config.deviceType === ScryptedDeviceType.Doorbell ? 'Video Doorbell' : 'Camera',
        description: `Frigate camera ${this.discovery.cameraName} through API-discovered go2rtc restreams`,
      },
    };
  }

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    const main = this.discovery.mainStream;
    const options: ResponseMediaStreamOptions[] = [{
      id: 'main',
      name: main.name || 'Main Stream',
      container: 'rtsp',
      source: 'local',
      destinations: ['local'],
      video: {
        codec: main.videoCodec || 'h264',
        width: main.width || 1920,
        height: main.height || 1080,
      },
      audio: main.audioCodec ? {
        codec: main.audioCodec,
        sampleRate: main.audioSampleRate,
      } : undefined,
    }];
    const sub = this.discovery.subStream;
    if (sub) {
      options.push({
        id: 'sub',
        name: sub.name || 'Low Resolution Stream',
        container: 'rtsp',
        source: 'local',
        destinations: ['medium-resolution', 'low-resolution', 'remote'],
        video: {
          codec: sub.videoCodec || 'h264',
          width: sub.width || 640,
          height: sub.height || 360,
        },
        audio: sub.audioCodec ? {
          codec: sub.audioCodec,
          sampleRate: sub.audioSampleRate,
        } : undefined,
      });
    }
    return options;
  }

  async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
    const wantsSubstream = options?.id === 'sub'
      || ['medium-resolution', 'low-resolution', 'remote'].includes(options?.destination || '');
    const stream = wantsSubstream && this.discovery.subStream
      ? this.discovery.subStream
      : this.discovery.mainStream;
    if (!this.discovery.restreamAvailable)
      throw new Error(`Frigate camera ${this.discovery.cameraName} has no go2rtc restream`);
    const input: FFmpegInput = {
      url: stream.rtspUrl,
      inputArguments: ['-rtsp_transport', 'tcp', '-i', stream.rtspUrl],
    };
    return mediaManager.createMediaObject(
      Buffer.from(JSON.stringify(input)),
      ScryptedMimeTypes.FFmpegInput,
    );
  }

  async takePicture(_options?: RequestPictureOptions): Promise<MediaObject> {
    return this.provider.takePicture(this.discovery.cameraName);
  }

  async getPictureOptions(): Promise<ResponsePictureOptions[]> {
    return [{ id: 'latest', name: 'Latest Frigate Frame' }];
  }

  async startIntercom(media: MediaObject): Promise<void> {
    if (!this.config.enableIntercom)
      throw new Error('Intercom is disabled for this camera');
    return this.provider.startIntercom(media, this.discovery);
  }

  async stopIntercom(): Promise<void> {
    return this.provider.stopIntercom();
  }

  async getSettings(): Promise<Setting[]> {
    return cameraSettings(this.config, this.discovery);
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    storeSetting(this.storage, key, value);
    this.config = readCameraConfig(this.storage, this.discovery.cameraName);
    this.doorbellPulse.stop();
    this.tamperPulse.stop();
    this.doorbellPulse = this.createDoorbellPulse();
    this.tamperPulse = this.createTamperPulse();
    return this.provider.cameraConfigurationChanged(this);
  }

  async destroy(): Promise<void> {
    this.doorbellPulse.stop();
    this.tamperPulse.stop();
    await this.provider.stopIntercom();
  }

  setMotion(active: boolean): void {
    this.motionDetected = active;
  }

  setAudio(active: boolean): void {
    if (this.discovery.audioDetection)
      this.audioDetected = active;
  }

  pulseDoorbell(eventKey?: string): void {
    if (this.config.deviceType === ScryptedDeviceType.Doorbell)
      this.doorbellPulse.trigger(eventKey);
  }

  pulseTamper(eventKey?: string): void {
    if (this.config.deviceType === ScryptedDeviceType.Doorbell)
      this.tamperPulse.trigger(eventKey);
  }

  setFrigateAvailable(available: boolean): void {
    if (this.lastFrigateAvailability !== available)
      this.console.info(`Frigate MQTT availability: ${available ? 'online' : 'offline'}`);
    this.lastFrigateAvailability = available;
  }

  setDeviceAvailable(available: boolean): void {
    if (this.lastDeviceAvailability !== available)
      this.console.info(`External device availability: ${available ? 'online' : 'offline'}`);
    this.lastDeviceAvailability = available;
  }

  setMqttConnected(connected: boolean): void {
    if (this.lastMqttConnected !== connected)
      this.console.info(`MQTT transport: ${connected ? 'connected' : 'disconnected'}`);
    this.lastMqttConnected = connected;
  }

  private createDoorbellPulse(): EdgePulse {
    return new EdgePulse(this.config.doorbellPulseMs, active => {
      this.binaryState = active;
    });
  }

  private createTamperPulse(): EdgePulse {
    return new EdgePulse(this.config.tamperPulseMs, active => {
      this.tampered = active ? 'cover' : false;
    });
  }
}
