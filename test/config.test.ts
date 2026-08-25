import { ScryptedDeviceType } from '@scrypted/sdk';
import { describe, expect, it } from 'vitest';
import {
  cameraSettingKeys,
  cameraSettings,
  homeKitSafeName,
  providerSettingKeys,
  providerSettings,
  readCameraConfig,
  readProviderConfig,
  storeSetting,
  type KeyValueStorage,
} from '../src/config';
import { discoveredCamera } from './fixtures';

class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('provider configuration', () => {
  it('contains only shared connection and camera-selection settings', () => {
    const config = readProviderConfig(new MemoryStorage());
    const settings = providerSettings(config, [discoveredCamera()], 'ready');
    const keys = settings.map(setting => setting.key).filter(Boolean);

    expect(config.importedCameras).toEqual([]);
    expect(keys).toContain(providerSettingKeys.frigateBaseUrl);
    expect(keys).toContain(providerSettingKeys.mqttUrl);
    expect(keys).toContain(providerSettingKeys.importedCameras);
    expect(keys).not.toContain('cameraName');
    expect(keys).not.toContain('motionTopic');
    expect(keys).not.toContain('doorbellTopic');
    expect(settings.find(setting => setting.key === providerSettingKeys.importedCameras)).toMatchObject({
      choices: ['front_door'],
      multiple: true,
    });
  });

  it('normalizes shared endpoint roots and persists checkbox selections', () => {
    const storage = new MemoryStorage();
    storage.setItem(providerSettingKeys.frigateBaseUrl, 'https://frigate.invalid///');
    storage.setItem(providerSettingKeys.go2rtcApiUrl, 'http://go2rtc.invalid:1984/');
    storeSetting(storage, providerSettingKeys.importedCameras, ['front_door', 'side_yard']);

    const config = readProviderConfig(storage);
    expect(config.frigateBaseUrl).toBe('https://frigate.invalid');
    expect(config.go2rtcApiUrl).toBe('http://go2rtc.invalid:1984');
    expect(config.importedCameras).toEqual(['front_door', 'side_yard']);
  });
});

describe('per-camera configuration', () => {
  it('hides doorbell-only settings on ordinary cameras', () => {
    const config = readCameraConfig(new MemoryStorage(), 'side_yard');
    const settings = cameraSettings(config, discoveredCamera({ cameraName: 'side_yard', audioDetection: false }));
    const keys = settings.map(setting => setting.key).filter(Boolean);

    expect(config.deviceType).toBe(ScryptedDeviceType.Camera);
    expect(config.deviceName).toBe('side yard');
    expect(keys).toContain(cameraSettingKeys.deviceType);
    expect(keys).toContain(cameraSettingKeys.enableIntercom);
    expect(keys).not.toContain(cameraSettingKeys.doorbellTopic);
    expect(keys).not.toContain(cameraSettingKeys.tamperTopic);
    expect(keys).not.toContain(providerSettingKeys.mqttUrl);
  });

  it('shows doorbell topics only after the camera type is Doorbell', () => {
    const storage = new MemoryStorage();
    storage.setItem(cameraSettingKeys.deviceType, ScryptedDeviceType.Doorbell);
    storage.setItem(cameraSettingKeys.doorbellTriggerRegex, '"button_click":1');
    storage.setItem(cameraSettingKeys.tamperTriggerRegex, '"tamper_alarm":1');
    storage.setItem(cameraSettingKeys.doorbellPulseMs, '1');
    storage.setItem(cameraSettingKeys.tamperPulseMs, '9999999');
    const config = readCameraConfig(storage, 'front_door');
    const keys = cameraSettings(config, discoveredCamera()).map(setting => setting.key).filter(Boolean);

    expect(keys).toContain(cameraSettingKeys.deviceAvailabilityTopic);
    expect(keys).toContain(cameraSettingKeys.doorbellTopic);
    expect(keys).toContain(cameraSettingKeys.doorbellTriggerRegex);
    expect(keys).toContain(cameraSettingKeys.tamperTopic);
    expect(keys).toContain(cameraSettingKeys.tamperTriggerRegex);
    expect(config.doorbellTriggerRegex).toBe('"button_click":1');
    expect(config.tamperTriggerRegex).toBe('"tamper_alarm":1');
    expect(config.doorbellPulseMs).toBe(250);
    expect(config.tamperPulseMs).toBe(300_000);
  });

  it('keeps the HomeKit display name syntactically safe', () => {
    const storage = new MemoryStorage();
    storage.setItem(cameraSettingKeys.deviceName, "--Front_Door's--");
    expect(readCameraConfig(storage, 'ignored').deviceName).toBe("Front Door's");
    expect(homeKitSafeName('***')).toBe('Frigate Camera');
  });
});
