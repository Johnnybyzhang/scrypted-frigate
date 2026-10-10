import sdk, {
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  type DeviceProvider,
  type HttpRequest,
  type HttpRequestHandler,
  type HttpResponse,
  type MediaObject,
  type Setting,
  type Settings,
  type SettingValue,
} from '@scrypted/sdk';
import { FrigateCamera, type BridgeProviderHost } from './camera';
import {
  providerSettingKeys,
  providerSettings,
  readProviderConfig,
  storeSetting,
} from './config';
import { FrigateClient } from './frigate-client';
import { DISCOVERY_FAILURES_BEFORE_OFFLINE, DiscoveryHealth } from './discovery-health';
import { Go2rtcIntercom, IntercomIngressRegistry, ScryptedFfmpegAudioSourceFactory } from './intercom';
import { MqttBridgeEvents } from './mqtt-camera-events';
import {
  cameraNameFromNativeId,
  cameraNativeId,
  type DiscoveredCamera,
  type Go2rtcConfig,
  type ProviderConfig,
} from './types';

const { deviceManager, endpointManager, mediaManager } = sdk;

class FrigateCameraProvider extends ScryptedDeviceBase implements DeviceProvider, HttpRequestHandler, Settings, BridgeProviderHost {
  private readonly cameras = new Map<string, FrigateCamera>();
  private discovered = new Map<string, DiscoveredCamera>();
  private config: ProviderConfig;
  private frigate: FrigateClient;
  private topicPrefix = 'frigate';
  private bridgeOnline = false;
  private readonly discoveryHealth = new DiscoveryHealth();
  private discoveryStatus = 'Configure the Frigate API URL, then refresh discovery.';
  private mqtt?: MqttBridgeEvents;
  private mqttFingerprint = '';
  private manifestFingerprint = '';
  private readonly ingressRegistry = new IntercomIngressRegistry();
  private readonly intercom = new Go2rtcIntercom(
    this.ingressRegistry,
    new ScryptedFfmpegAudioSourceFactory(mediaManager),
    endpointManager,
  );
  private operation: Promise<void> = Promise.resolve();
  private readonly refreshTimer: NodeJS.Timeout;

  constructor() {
    super();
    this.config = readProviderConfig(this.storage);
    this.frigate = new FrigateClient(this.config, mediaManager);
    this.refreshTimer = setInterval(() => void this.queueRefresh(false), 30_000);
    this.refreshTimer.unref?.();
    void this.queueRefresh(true);
  }

  async getSettings(): Promise<Setting[]> {
    return providerSettings(this.config, [...this.discovered.values()], this.discoveryStatus);
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    if (key !== providerSettingKeys.refreshCameras)
      storeSetting(this.storage, key, value);
    this.config = readProviderConfig(this.storage);
    this.frigate = new FrigateClient(this.config, mediaManager);
    return this.queueRefresh(true);
  }

  async getDevice(nativeId: string): Promise<FrigateCamera | undefined> {
    const existing = this.cameras.get(nativeId);
    if (existing)
      return existing;
    const cameraName = cameraNameFromNativeId(nativeId);
    const discovery = cameraName ? this.discovered.get(cameraName) : undefined;
    if (!discovery || !this.config.importedCameras.includes(discovery.cameraName))
      return undefined;
    const camera = new FrigateCamera(this, nativeId, discovery);
    this.cameras.set(nativeId, camera);
    return camera;
  }

  async releaseDevice(_id: string, nativeId: string): Promise<void> {
    const camera = this.cameras.get(nativeId);
    if (!camera)
      return;
    await camera.destroy();
    this.cameras.delete(nativeId);
  }

  async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
    return this.ingressRegistry.onRequest(request, response);
  }

  canIntercom(): boolean {
    return Boolean(this.frigate.effectiveGo2rtcApiUrl());
  }

  async cameraConfigurationChanged(_camera: FrigateCamera): Promise<void> {
    return this.serialized(() => this.syncImportedCameras(this.bridgeOnline));
  }

  async takePicture(cameraName: string): Promise<MediaObject> {
    return this.frigate.takePicture(cameraName);
  }

  async startIntercom(media: MediaObject, camera: DiscoveredCamera): Promise<void> {
    const config: Go2rtcConfig = {
      apiUrl: this.frigate.effectiveGo2rtcApiUrl(),
      apiUsername: this.config.go2rtcApiUsername,
      apiPassword: this.config.go2rtcApiPassword,
      streamName: camera.mainStream.id,
    };
    return this.intercom.start(media, config);
  }

  async stopIntercom(): Promise<void> {
    return this.intercom.stop();
  }

  private queueRefresh(scan: boolean): Promise<void> {
    return this.serialized(() => this.refreshDiscovery(scan));
  }

  private async refreshDiscovery(_scan: boolean): Promise<void> {
    this.config = readProviderConfig(this.storage);
    this.frigate = new FrigateClient(this.config, mediaManager);
    if (!this.config.frigateBaseUrl) {
      this.bridgeOnline = false;
      this.discoveryHealth.reset();
      this.discoveryStatus = 'Frigate API URL is not configured.';
      this.discovered.clear();
      await this.syncImportedCameras(false);
      return;
    }
    try {
      const result = await this.frigate.discoverCameras();
      const next = new Map(result.cameras.map(camera => [camera.cameraName, camera]));
      for (const cameraName of this.config.importedCameras) {
        if (!next.has(cameraName)) {
          const stale = this.discovered.get(cameraName);
          if (stale)
            next.set(cameraName, { ...stale, restreamAvailable: false });
        }
      }
      this.discovered = next;
      this.bridgeOnline = true;
      this.discoveryHealth.succeeded();
      this.topicPrefix = result.topicPrefix;
      const missingRestreams = result.cameras.filter(camera => !camera.restreamAvailable).length;
      const summary = `${result.cameras.length} Frigate camera(s) discovered${missingRestreams ? `; ${missingRestreams} without configured go2rtc restreams` : ''}.`;
      this.discoveryStatus = result.warning ? `${summary} ${result.warning}.` : summary;
      await this.syncImportedCameras(true);
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const state = this.discoveryHealth.failed(this.discovered.size > 0);
      this.bridgeOnline = state.online;
      this.discoveryStatus = state.usingLastKnownInventory
        ? `Discovery failed: ${message}. Keeping the last camera inventory online while Frigate recovers (${state.consecutiveFailures}/${DISCOVERY_FAILURES_BEFORE_OFFLINE}).`
        : `Discovery failed: ${message}. Cameras are offline after ${state.consecutiveFailures} consecutive failure(s).`;
      this.console.error('Frigate camera discovery failed', error);
      // On a cold start nothing has been discovered yet, so syncing would publish an
      // empty device list and make Scrypted delete the existing camera devices and
      // their settings. Leave them untouched until Frigate answers.
      if (state.inventoryUnknown)
        return;
      await this.syncImportedCameras(this.bridgeOnline);
    }
  }

  private async syncImportedCameras(bridgeOnline: boolean): Promise<void> {
    const selected = new Set(this.config.importedCameras);
    for (const [nativeId, camera] of [...this.cameras]) {
      if (selected.has(camera.cameraName))
        continue;
      await camera.destroy();
      this.cameras.delete(nativeId);
    }

    for (const cameraName of selected) {
      const discovery = this.discovered.get(cameraName);
      if (!discovery)
        continue;
      const nativeId = cameraNativeId(cameraName);
      let camera = this.cameras.get(nativeId);
      if (!camera) {
        const interfaces = [
          ScryptedInterface.Camera,
          ScryptedInterface.MotionSensor,
          ScryptedInterface.Online,
          ScryptedInterface.Settings,
          ScryptedInterface.VideoCamera,
        ];
        if (discovery.audioDetection)
          interfaces.push(ScryptedInterface.AudioSensor);
        await deviceManager.onDeviceDiscovered({
          nativeId,
          name: cameraName,
          type: ScryptedDeviceType.Camera,
          interfaces,
        });
        camera = new FrigateCamera(this, nativeId, discovery);
        this.cameras.set(nativeId, camera);
      }
      else {
        camera.updateDiscovery(discovery);
      }
      camera.setBridgeOnline(bridgeOnline);
    }

    const devices = [...this.cameras.values()].map(camera => camera.descriptor());
    const manifestFingerprint = JSON.stringify(devices);
    if (manifestFingerprint !== this.manifestFingerprint) {
      this.manifestFingerprint = manifestFingerprint;
      await deviceManager.onDevicesChanged({ devices });
    }
    this.cameras.forEach(camera => camera.initializeStates());
    this.configureMqtt();
  }

  private configureMqtt(): void {
    const routes = [...this.cameras.values()].map(camera => ({
      cameraName: camera.cameraName,
      audioDetection: this.discovered.get(camera.cameraName)?.audioDetection || false,
      config: camera.getCameraConfig(),
      sink: camera,
    }));
    const mqttFingerprint = JSON.stringify({
      mqttUrl: this.config.mqttUrl,
      mqttUsername: this.config.mqttUsername,
      mqttPassword: this.config.mqttPassword,
      topicPrefix: this.topicPrefix,
      routes: routes.map(route => ({
        cameraName: route.cameraName,
        audioDetection: route.audioDetection,
        deviceType: route.config.deviceType,
        deviceAvailabilityTopic: route.config.deviceAvailabilityTopic,
        doorbellTopic: route.config.doorbellTopic,
        doorbellTriggerRegex: route.config.doorbellTriggerRegex,
        tamperTopic: route.config.tamperTopic,
        tamperTriggerRegex: route.config.tamperTriggerRegex,
      })),
    });
    if (mqttFingerprint === this.mqttFingerprint)
      return;
    this.mqttFingerprint = mqttFingerprint;
    this.mqtt?.stop();
    this.mqtt = new MqttBridgeEvents(
      this.config,
      this.topicPrefix,
      routes,
      { onLog: message => this.console.warn(message) },
    );
    this.mqtt.start();
  }

  private serialized(operation: () => Promise<void>): Promise<void> {
    const next = this.operation.then(operation, operation);
    this.operation = next.catch(error => {
      this.console.error('Frigate bridge operation failed', error);
    });
    return next;
  }
}

export default new FrigateCameraProvider();
