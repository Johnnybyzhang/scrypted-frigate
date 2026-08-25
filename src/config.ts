import {
  ScryptedDeviceType,
  type Setting,
  type SettingValue,
} from '@scrypted/sdk';
import type { CameraConfig, DiscoveredCamera, ProviderConfig } from './types';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export const providerSettingKeys = {
  frigateBaseUrl: 'frigateBaseUrl',
  frigateApiToken: 'frigateApiToken',
  rtspRestreamBaseUrl: 'rtspRestreamBaseUrl',
  mqttUrl: 'mqttUrl',
  mqttUsername: 'mqttUsername',
  mqttPassword: 'mqttPassword',
  go2rtcApiUrl: 'go2rtcApiUrl',
  go2rtcApiUsername: 'go2rtcApiUsername',
  go2rtcApiPassword: 'go2rtcApiPassword',
  importedCameras: 'importedCameras',
  refreshCameras: 'refreshCameras',
} as const;

export const cameraSettingKeys = {
  deviceName: 'deviceName',
  deviceType: 'deviceType',
  enableIntercom: 'enableIntercom',
  deviceAvailabilityTopic: 'deviceAvailabilityTopic',
  doorbellTopic: 'doorbellTopic',
  doorbellTriggerRegex: 'doorbellTriggerRegex',
  tamperTopic: 'tamperTopic',
  tamperTriggerRegex: 'tamperTriggerRegex',
  doorbellPulseMs: 'doorbellPulseMs',
  tamperPulseMs: 'tamperPulseMs',
} as const;

function read(storage: KeyValueStorage, key: string, fallback = ''): string {
  return storage.getItem(key)?.trim() || fallback;
}

function readBoolean(storage: KeyValueStorage, key: string, fallback = false): boolean {
  const value = storage.getItem(key);
  if (value === null)
    return fallback;
  return value === 'true';
}

function readStringArray(storage: KeyValueStorage, key: string): string[] {
  const value = storage.getItem(key);
  if (!value)
    return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed))
      return [...new Set(parsed.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))];
  }
  catch {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function positiveInteger(value: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed))
    return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function homeKitSafeName(value: string): string {
  const normalized = value
    .replace(/[^A-Za-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  return normalized || 'Frigate Camera';
}

export function readProviderConfig(storage: KeyValueStorage): ProviderConfig {
  return {
    frigateBaseUrl: trimTrailingSlash(read(storage, providerSettingKeys.frigateBaseUrl)),
    frigateApiToken: read(storage, providerSettingKeys.frigateApiToken),
    rtspRestreamBaseUrl: trimTrailingSlash(read(storage, providerSettingKeys.rtspRestreamBaseUrl)),
    mqttUrl: read(storage, providerSettingKeys.mqttUrl),
    mqttUsername: read(storage, providerSettingKeys.mqttUsername),
    mqttPassword: read(storage, providerSettingKeys.mqttPassword),
    go2rtcApiUrl: trimTrailingSlash(read(storage, providerSettingKeys.go2rtcApiUrl)),
    go2rtcApiUsername: read(storage, providerSettingKeys.go2rtcApiUsername),
    go2rtcApiPassword: read(storage, providerSettingKeys.go2rtcApiPassword),
    importedCameras: readStringArray(storage, providerSettingKeys.importedCameras),
  };
}

export function readCameraConfig(storage: KeyValueStorage, cameraName: string): CameraConfig {
  const configuredType = read(storage, cameraSettingKeys.deviceType, ScryptedDeviceType.Camera);
  const deviceType = configuredType === ScryptedDeviceType.Doorbell
    ? ScryptedDeviceType.Doorbell
    : ScryptedDeviceType.Camera;
  return {
    deviceName: homeKitSafeName(read(storage, cameraSettingKeys.deviceName, cameraName)),
    deviceType,
    enableIntercom: readBoolean(storage, cameraSettingKeys.enableIntercom),
    deviceAvailabilityTopic: read(storage, cameraSettingKeys.deviceAvailabilityTopic),
    doorbellTopic: read(storage, cameraSettingKeys.doorbellTopic),
    doorbellTriggerRegex: read(storage, cameraSettingKeys.doorbellTriggerRegex),
    tamperTopic: read(storage, cameraSettingKeys.tamperTopic),
    tamperTriggerRegex: read(storage, cameraSettingKeys.tamperTriggerRegex),
    doorbellPulseMs: positiveInteger(read(storage, cameraSettingKeys.doorbellPulseMs), 1500, 250, 30_000),
    tamperPulseMs: positiveInteger(read(storage, cameraSettingKeys.tamperPulseMs), 10_000, 1000, 300_000),
  };
}

export function providerSettings(
  config: ProviderConfig,
  discovered: DiscoveredCamera[],
  discoveryStatus: string,
): Setting[] {
  const cameraChoices = discovered.map(camera => camera.cameraName).sort((left, right) => left.localeCompare(right));
  return [
    {
      key: providerSettingKeys.frigateBaseUrl,
      title: 'Frigate API URL',
      group: 'Frigate',
      value: config.frigateBaseUrl,
      placeholder: 'https://frigate.example:8971',
      description: 'Used to discover configured cameras, go2rtc stream names, MQTT prefix, health, and snapshots.',
    },
    { key: providerSettingKeys.frigateApiToken, title: 'Frigate API Token', group: 'Frigate', value: config.frigateApiToken, type: 'password' },
    {
      key: providerSettingKeys.rtspRestreamBaseUrl,
      title: 'RTSP Restream Base Override',
      group: 'Frigate',
      value: config.rtspRestreamBaseUrl,
      placeholder: 'rtsp://frigate-host:8554',
      description: 'Optional shared override. By default the plugin derives rtsp://<Frigate API host>:8554 and appends API-discovered go2rtc stream names.',
    },
    { key: providerSettingKeys.refreshCameras, title: 'Refresh Frigate Cameras', group: 'Cameras', type: 'button', immediate: true },
    {
      key: providerSettingKeys.importedCameras,
      title: 'Imported Cameras',
      group: 'Cameras',
      value: config.importedCameras,
      choices: cameraChoices,
      multiple: true,
      immediate: true,
      description: cameraChoices.length
        ? 'Check cameras to add them to Scrypted; uncheck them to remove only the Scrypted child device.'
        : 'Configure Frigate and refresh discovery before selecting cameras.',
    },
    { title: 'Discovery Status', group: 'Cameras', readonly: true, value: discoveryStatus },
    { key: providerSettingKeys.mqttUrl, title: 'MQTT Broker URL', group: 'MQTT', value: config.mqttUrl, placeholder: 'mqtts://broker.example:8883' },
    { key: providerSettingKeys.mqttUsername, title: 'MQTT Username', group: 'MQTT', value: config.mqttUsername },
    { key: providerSettingKeys.mqttPassword, title: 'MQTT Password', group: 'MQTT', value: config.mqttPassword, type: 'password' },
    {
      key: providerSettingKeys.go2rtcApiUrl,
      title: 'go2rtc API URL',
      group: 'Talkback',
      value: config.go2rtcApiUrl,
      placeholder: 'http://frigate-host:1984',
      description: 'Optional shared override for stream-to-camera talkback. The default is derived from the Frigate API host on port 1984.',
    },
    { key: providerSettingKeys.go2rtcApiUsername, title: 'go2rtc API Username', group: 'Talkback', value: config.go2rtcApiUsername },
    { key: providerSettingKeys.go2rtcApiPassword, title: 'go2rtc API Password', group: 'Talkback', value: config.go2rtcApiPassword, type: 'password' },
  ];
}

export function cameraSettings(config: CameraConfig, camera: DiscoveredCamera): Setting[] {
  const main = `${camera.mainStream.name} (${camera.mainStream.id})`;
  const sub = camera.subStream ? `${camera.subStream.name} (${camera.subStream.id})` : 'Not discovered';
  const settings: Setting[] = [
    { title: 'Frigate Camera', group: 'Discovery', readonly: true, value: camera.cameraName },
    { title: 'Restream Status', group: 'Discovery', readonly: true, value: camera.restreamAvailable ? 'Configured' : 'Not configured in Frigate' },
    { title: 'Main Stream', group: 'Discovery', readonly: true, value: main },
    { title: 'Low Resolution Stream', group: 'Discovery', readonly: true, value: sub },
    { key: cameraSettingKeys.deviceName, title: 'Scrypted Device Name', group: 'Camera', value: config.deviceName },
    {
      key: cameraSettingKeys.deviceType,
      title: 'Scrypted Device Type',
      group: 'Camera',
      value: config.deviceType,
      choices: [ScryptedDeviceType.Camera, ScryptedDeviceType.Doorbell],
      immediate: true,
      description: 'Doorbell exposes press and tamper sensors. Ordinary cameras do not show or subscribe to those settings.',
    },
    {
      key: cameraSettingKeys.enableIntercom,
      title: 'Enable Intercom',
      group: 'Camera',
      type: 'boolean',
      value: config.enableIntercom,
      immediate: true,
      description: 'Expose two-way audio for this camera through its API-discovered main go2rtc stream.',
    },
  ];
  if (config.deviceType === ScryptedDeviceType.Doorbell) {
    settings.push(
      { key: cameraSettingKeys.deviceAvailabilityTopic, title: 'Device Availability Topic', group: 'Doorbell Events', value: config.deviceAvailabilityTopic, placeholder: 'site/front_door/availability' },
      { key: cameraSettingKeys.doorbellTopic, title: 'Doorbell Press Topic', group: 'Doorbell Events', value: config.doorbellTopic, placeholder: 'site/front_door/doorbell' },
      {
        key: cameraSettingKeys.doorbellTriggerRegex,
        title: 'Doorbell Trigger Regex',
        group: 'Doorbell Events',
        value: config.doorbellTriggerRegex,
        placeholder: '"kind":"doorbell_ring".*"button_click":1',
        description: 'Optional case-insensitive JavaScript regex. JSON is also tested in compact form, so whitespace does not matter. ON, 1, and true trigger without a regex.',
      },
      { key: cameraSettingKeys.tamperTopic, title: 'Tamper Topic', group: 'Doorbell Events', value: config.tamperTopic, placeholder: 'site/front_door/tamper' },
      {
        key: cameraSettingKeys.tamperTriggerRegex,
        title: 'Tamper Trigger Regex',
        group: 'Doorbell Events',
        value: config.tamperTriggerRegex,
        placeholder: '"kind":"tamper".*"tamper_alarm":1',
        description: 'Optional case-insensitive JavaScript regex. JSON is also tested in compact form, so whitespace does not matter. ON, 1, and true trigger without a regex.',
      },
      { key: cameraSettingKeys.doorbellPulseMs, title: 'Doorbell Pulse (ms)', group: 'Doorbell Events', value: config.doorbellPulseMs, type: 'number' },
      { key: cameraSettingKeys.tamperPulseMs, title: 'Tamper Pulse (ms)', group: 'Doorbell Events', value: config.tamperPulseMs, type: 'number' },
    );
  }
  return settings;
}

export function storeSetting(storage: KeyValueStorage, key: string, value: SettingValue): void {
  if (value === undefined || value === null || value === '') {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
}
