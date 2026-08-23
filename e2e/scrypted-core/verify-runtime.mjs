import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { connectScryptedClient } from '@scrypted/client';
import mqtt from 'mqtt';

const baseUrl = process.env.SCRYPTED_E2E_URL || 'https://127.0.0.1:10443';
const evidencePath = process.env.SCRYPTED_E2E_EVIDENCE;

async function waitFor(description, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value)
      return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${description}`);
}

const originalLog = console.log;
console.log = () => {};
const sdk = await connectScryptedClient({
  baseUrl,
  pluginId: '@scrypted/core',
  transports: ['polling', 'websocket'],
});
console.log = originalLog;

const allDevices = () => Object.keys(sdk.systemManager.getSystemState())
  .map(id => sdk.systemManager.getDeviceById(id))
  .filter(Boolean);
const findPlugin = pluginId => allDevices().find(device => device.pluginId === pluginId && !device.nativeId);
const bridgeDevices = () => allDevices().filter(device => device.pluginId === '@johnnybyzhang/scrypted-frigate' && device.nativeId);
const front = bridgeDevices().find(device => device.nativeId.includes('front_door'));
const side = bridgeDevices().find(device => device.nativeId.includes('side_yard'));
assert(front && side, 'both imported bridge cameras must exist');

const expectedPlugins = [
  '@scrypted/core',
  '@scrypted/homekit',
  '@scrypted/prebuffer-mixin',
  '@scrypted/webrtc',
  '@johnnybyzhang/scrypted-frigate',
];
const plugins = Object.fromEntries(expectedPlugins.map(id => {
  const plugin = findPlugin(id);
  assert(plugin, `plugin is missing: ${id}`);
  return [id, plugin.info?.version || 'local'];
}));
const provider = findPlugin('@johnnybyzhang/scrypted-frigate');
assert(provider, 'Frigate Camera Bridge provider is missing');

assert.equal(sdk.serverVersion, '0.143.0');
assert.equal(front.name, 'Front Door E2E');
assert.equal(front.type, 'Doorbell');
assert.equal(front.online, true);
for (const iface of ['VideoCamera', 'Camera', 'MotionSensor', 'AudioSensor', 'BinarySensor', 'TamperSensor', 'Intercom', 'Online', 'Settings'])
  assert(front.providedInterfaces.includes(iface), `front door is missing provided interface: ${iface}`);

assert.equal(side.name, 'Side Yard E2E');
assert.equal(side.type, 'Camera');
assert.equal(side.online, true);
for (const iface of ['VideoCamera', 'Camera', 'MotionSensor', 'Online', 'Settings'])
  assert(side.providedInterfaces.includes(iface), `ordinary camera is missing provided interface: ${iface}`);
for (const iface of ['AudioSensor', 'BinarySensor', 'TamperSensor', 'Intercom'])
  assert(!side.providedInterfaces.includes(iface), `ordinary camera incorrectly exposes interface: ${iface}`);

for (const camera of [front, side]) {
  for (const pluginId of ['@scrypted/homekit', '@scrypted/prebuffer-mixin', '@scrypted/webrtc']) {
    const plugin = findPlugin(pluginId);
    assert(camera.mixins.includes(plugin.id), `${camera.name} is missing mixin: ${pluginId}`);
  }
}

const frontOptions = await front.getVideoStreamOptions();
assert.equal(frontOptions.length, 2);
assert.equal(frontOptions[0].video.codec, 'h264');
assert.equal(frontOptions[0].video.width, 1920);
assert.equal(frontOptions[0].video.height, 1080);
assert.equal(frontOptions[0].audio.codec, 'aac');
assert.equal(frontOptions[1].video.width, 640);
assert.equal(frontOptions[1].video.height, 360);

const sideOptions = await side.getVideoStreamOptions();
assert.equal(sideOptions.length, 2);
assert.equal(sideOptions[0].video.width, 1280);
assert.equal(sideOptions[0].video.height, 720);
assert.equal(sideOptions[0].audio, undefined);
assert.equal(sideOptions[1].video.width, 640);

async function setGo2rtcInventoryMode(mode) {
  const response = await fetch(`http://127.0.0.1:11885/control/go2rtc-inventory?mode=${mode}`, {
    method: 'POST',
  });
  assert.equal(response.ok, true, `failed to set go2rtc inventory mode to ${mode}`);
}

await setGo2rtcInventoryMode('empty');
await provider.putSetting('refreshCameras', true);
assert.equal(front.online, true, 'an idle go2rtc inventory made the doorbell unavailable');
assert.equal(side.online, true, 'an idle go2rtc inventory made the camera unavailable');

await setGo2rtcInventoryMode('error');
await provider.putSetting('refreshCameras', true);
assert.equal(front.online, true, 'a go2rtc metadata error made the doorbell unavailable');
assert.equal(side.online, true, 'a go2rtc metadata error made the camera unavailable');
const degradedDiscoveryStatus = (await provider.getSettings())
  .find(setting => setting.title === 'Discovery Status')?.value;
assert.match(String(degradedDiscoveryStatus), /go2rtc stream metadata unavailable/);

await setGo2rtcInventoryMode('normal');
await provider.putSetting('refreshCameras', true);

async function rebroadcastInputs(camera) {
  const mainMedia = await camera.getVideoStream({ id: 'main' });
  const subMedia = await camera.getVideoStream({ id: 'sub' });
  const main = await sdk.mediaManager.convertMediaObjectToJSON(mainMedia, 'x-scrypted/x-ffmpeg-input');
  const sub = await sdk.mediaManager.convertMediaObjectToJSON(subMedia, 'x-scrypted/x-ffmpeg-input');
  assert.match(main.url, /^rtsp:\/\/127\.0\.0\.1:\d+\//, `${camera.name} main stream did not pass through Rebroadcast`);
  assert.match(sub.url, /^rtsp:\/\/127\.0\.0\.1:\d+\//, `${camera.name} sub stream did not pass through Rebroadcast`);
  return { main: main.url, sub: sub.url };
}

const rebroadcast = {
  frontDoor: await rebroadcastInputs(front),
  sideYard: await rebroadcastInputs(side),
};

async function takeJpeg(camera) {
  const picture = await camera.takePicture();
  const jpeg = await sdk.mediaManager.convertMediaObjectToBuffer(picture, 'image/jpeg');
  assert(jpeg.length > 1000, `${camera.name} snapshot is unexpectedly small`);
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);
  return jpeg.length;
}
const snapshots = {
  frontDoorBytes: await takeJpeg(front),
  sideYardBytes: await takeJpeg(side),
};

const providerSettings = await provider.getSettings();
const providerKeys = providerSettings.map(setting => setting.key).filter(Boolean);
for (const key of ['doorbellTopic', 'tamperTopic', 'deviceAvailabilityTopic', 'motionTopic', 'audioTopic', 'mainStreamUrl', 'subStreamUrl'])
  assert(!providerKeys.includes(key), `provider leaked per-camera setting ${key}`);

const frontSettings = await front.getSettings();
const sideSettings = await side.getSettings();
for (const settings of [frontSettings, sideSettings]) {
  const keys = settings.map(setting => setting.key).filter(Boolean);
  for (const key of ['mqttUrl', 'mqttUsername', 'mqttPassword', 'frigateBaseUrl', 'go2rtcApiUrl'])
    assert(!keys.includes(key), `camera leaked provider setting ${key}`);
}
for (const key of ['doorbellTopic', 'tamperTopic', 'deviceAvailabilityTopic']) {
  assert(frontSettings.some(setting => setting.key === key), `doorbell camera is missing ${key}`);
  assert(!sideSettings.some(setting => setting.key === key), `ordinary camera exposed ${key}`);
}
for (const settings of [frontSettings, sideSettings]) {
  assert(settings.some(setting => setting.key === 'prebuffer:rtspRebroadcastUrl'));
  assert(settings.some(setting => setting.key === 'homekit:standalone' && setting.value === true));
}

const mqttClient = mqtt.connect('mqtt://127.0.0.1:11883', { connectTimeout: 5000 });
await new Promise((resolve, reject) => {
  mqttClient.once('connect', resolve);
  mqttClient.once('error', reject);
});
const publish = (topic, value) => new Promise((resolve, reject) => {
  mqttClient.publish(topic, value, { qos: 1, retain: false }, error => error ? reject(error) : resolve());
});

await publish('frigate/available', 'online');
await publish('frigate/front_door/motion', 'ON');
await publish('frigate/front_door/audio/all', 'ON');
await publish('frigate/side_yard/motion', 'ON');
await publish('site/front_door/doorbell', '{"id":"scrypted-core-e2e-doorbell"}');
await publish('site/front_door/tamper', '{"id":"scrypted-core-e2e-tamper"}');
await waitFor('multi-camera MQTT state fanout', () => front.motionDetected === true
  && front.audioDetected === true
  && front.binaryState === true
  && front.tampered === 'cover'
  && side.motionDetected === true);

await publish('frigate/front_door/motion', 'OFF');
await publish('frigate/front_door/audio/all', 'OFF');
await publish('frigate/side_yard/motion', 'OFF');
await waitFor('multi-camera MQTT level reset', () => front.motionDetected === false
  && front.audioDetected === false
  && side.motionDetected === false);
await waitFor('doorbell pulse reset', () => front.binaryState === false, 5000);

const toneUrl = 'http://127.0.0.1:11885/tone.opus';
const tone = await sdk.mediaManager.createFFmpegMediaObject({
  url: toneUrl,
  inputArguments: ['-re', '-acodec', 'libopus', '-i', toneUrl],
});
await front.startIntercom(tone);
await new Promise(resolve => setTimeout(resolve, 4000));
await front.stopIntercom();
await mqttClient.endAsync(true);

const evidence = {
  cameras: {
    frontDoor: {
      id: front.id,
      interfaces: front.providedInterfaces,
      mixins: front.mixins,
      name: front.name,
      online: front.online,
      type: front.type,
    },
    sideYard: {
      id: side.id,
      interfaces: side.providedInterfaces,
      mixins: side.mixins,
      name: side.name,
      online: side.online,
      type: side.type,
    },
  },
  discovery: {
    choices: providerSettings.find(setting => setting.key === 'importedCameras')?.choices,
    idleInventoryKeptOnline: true,
    metadataFailureKeptOnline: true,
    selected: providerSettings.find(setting => setting.key === 'importedCameras')?.value,
  },
  homekit: {
    pluginLoaded: true,
    standaloneAccessoryMode: true,
  },
  mqtt: {
    frontAudio: 'on then off',
    frontDoorbell: 'pulse then reset',
    frontMotion: 'on then off',
    frontTamper: 'cover pulse',
    sideMotion: 'on then off',
  },
  plugins,
  rebroadcast,
  snapshots,
  scryptedServerVersion: sdk.serverVersion,
  streamOptions: {
    frontDoor: frontOptions,
    sideYard: sideOptions,
  },
};

if (evidencePath)
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));
sdk.disconnect();
