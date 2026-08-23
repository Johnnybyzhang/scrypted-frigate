import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { connectScryptedClient } from '@scrypted/client';

const baseUrl = process.env.SCRYPTED_E2E_URL || 'https://127.0.0.1:10443';
const evidencePath = process.env.SCRYPTED_E2E_LAYOUT_EVIDENCE;

async function waitFor(description, predicate, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value)
      return value;
    await new Promise(resolve => setTimeout(resolve, 200));
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
const provider = allDevices().find(device => device.pluginId === '@johnnybyzhang/scrypted-frigate' && !device.nativeId);
assert(provider, 'Frigate Camera Bridge provider is missing');

for (const [key, value] of Object.entries({
  rtspRestreamBaseUrl: 'rtsp://127.0.0.1:18554',
  mqttUrl: 'mqtt://127.0.0.1:11883',
  go2rtcApiUrl: 'http://127.0.0.1:11984',
  frigateBaseUrl: 'http://127.0.0.1:11885',
}))
  await provider.putSetting(key, value);

const discoveredSelection = await waitFor('Frigate camera choices', async () => {
  const settings = await provider.getSettings();
  const selection = settings.find(setting => setting.key === 'importedCameras');
  return selection?.choices?.length === 2 ? selection : undefined;
});
assert.deepEqual(discoveredSelection.choices, ['front_door', 'side_yard']);
await provider.putSetting('importedCameras', ['front_door', 'side_yard']);

let cameras = await waitFor('two imported Scrypted cameras', () => {
  const imported = allDevices().filter(device => device.pluginId === '@johnnybyzhang/scrypted-frigate' && device.nativeId);
  return imported.length === 2 ? imported : undefined;
});
let front = cameras.find(camera => camera.nativeId.includes('front_door'));
let side = cameras.find(camera => camera.nativeId.includes('side_yard'));
assert(front && side, 'imported camera identities are incorrect');
const stableIds = { front: front.nativeId, side: side.nativeId };
const cameraByNativeId = nativeId => allDevices().find(device => device.nativeId === nativeId);

// Prove that discovery behaves like a checkbox-based camera provider: removing a
// selection releases only that Scrypted child, and selecting it again restores
// the same stable native id without changing the upstream Frigate inventory.
await provider.putSetting('importedCameras', ['front_door']);
await waitFor('side yard child removal', () => {
  const imported = allDevices().filter(device => device.pluginId === '@johnnybyzhang/scrypted-frigate' && device.nativeId);
  return imported.length === 1 && imported[0].nativeId === stableIds.front ? imported[0] : undefined;
});
const selectionAfterRemoval = (await provider.getSettings()).find(setting => setting.key === 'importedCameras');
assert.deepEqual(selectionAfterRemoval?.choices, ['front_door', 'side_yard'], 'unchecking a child changed the discovered Frigate inventory');
await provider.putSetting('importedCameras', ['front_door', 'side_yard']);
cameras = await waitFor('stable child re-addition', () => {
  const imported = allDevices().filter(device => device.pluginId === '@johnnybyzhang/scrypted-frigate' && device.nativeId);
  return imported.length === 2 ? imported : undefined;
});
front = cameras.find(camera => camera.nativeId === stableIds.front);
side = cameras.find(camera => camera.nativeId === stableIds.side);
assert(front && side, 're-added cameras did not retain stable native ids');

for (const [key, value] of Object.entries({
  deviceName: 'Front Door E2E',
  enableIntercom: true,
  deviceAvailabilityTopic: 'site/front_door/availability',
  doorbellTopic: 'site/front_door/doorbell',
  tamperTopic: 'site/front_door/tamper',
}))
  await front.putSetting(key, value);
await front.putSetting('deviceType', 'Doorbell');
front = await waitFor('front door descriptor update', () => {
  const camera = cameraByNativeId(stableIds.front);
  return camera?.name === 'Front Door E2E' && camera.type === 'Doorbell' ? camera : undefined;
});
await side.putSetting('deviceName', 'Side Yard E2E');
side = await waitFor('side yard name update', () => {
  const camera = cameraByNativeId(stableIds.side);
  return camera?.name === 'Side Yard E2E' ? camera : undefined;
});
await front.setMixins([]);
await side.setMixins([]);

async function upstreamInput(camera, id) {
  const media = await camera.getVideoStream({ id });
  return sdk.mediaManager.convertMediaObjectToJSON(media, 'x-scrypted/x-ffmpeg-input');
}
const upstream = {
  frontDoorMain: await upstreamInput(front, 'main'),
  frontDoorSub: await upstreamInput(front, 'sub'),
  sideYardMain: await upstreamInput(side, 'main'),
  sideYardSub: await upstreamInput(side, 'sub'),
};
assert.equal(upstream.frontDoorMain.url, 'rtsp://127.0.0.1:18554/Scrypted-E2E-Doorbell?video=h264&audio');
assert.equal(upstream.frontDoorSub.url, 'rtsp://127.0.0.1:18554/Scrypted-E2E-Doorbell-Sub?video=h264&audio');
assert.equal(upstream.sideYardMain.url, 'rtsp://127.0.0.1:18554/Scrypted-E2E-Side?video=h264&audio');
assert.equal(upstream.sideYardSub.url, 'rtsp://127.0.0.1:18554/Scrypted-E2E-Side-Sub?video=h264&audio');

const mixinPluginIds = ['@scrypted/prebuffer-mixin', '@scrypted/webrtc', '@scrypted/snapshot', '@scrypted/homekit'];
const mixins = mixinPluginIds.map(pluginId => {
  const plugin = allDevices().find(device => device.pluginId === pluginId && !device.nativeId);
  assert(plugin, `missing mixin provider ${pluginId}`);
  return plugin.id;
});
for (const camera of [front, side]) {
  await camera.setMixins([...new Set([...camera.mixins, ...mixins])]);
  for (const [key, value] of Object.entries({
    'prebuffer:enabledStreams': ['Main Stream', 'Low Resolution Stream'],
    'homekit:standalone': true,
    'homekit:debugMode': ['Save Recordings'],
  }))
    await camera.putSetting(key, value);
}

await new Promise(resolve => setTimeout(resolve, 12_000));
const providerSettings = await provider.getSettings();
const frontSettings = await front.getSettings();
const sideSettings = await side.getSettings();
const providerKeys = providerSettings.map(setting => setting.key).filter(Boolean);
const frontKeys = frontSettings.map(setting => setting.key).filter(Boolean);
const sideKeys = sideSettings.map(setting => setting.key).filter(Boolean);

for (const key of ['doorbellTopic', 'tamperTopic', 'deviceAvailabilityTopic', 'mainStreamUrl', 'subStreamUrl', 'motionTopic', 'audioTopic'])
  assert(!providerKeys.includes(key), `provider leaked per-camera setting ${key}`);
for (const key of ['mqttUrl', 'mqttUsername', 'mqttPassword', 'frigateBaseUrl', 'go2rtcApiUrl']) {
  assert(!frontKeys.includes(key), `front camera leaked provider setting ${key}`);
  assert(!sideKeys.includes(key), `side camera leaked provider setting ${key}`);
}
for (const key of ['doorbellTopic', 'tamperTopic', 'deviceAvailabilityTopic']) {
  assert(frontKeys.includes(key), `doorbell camera is missing ${key}`);
  assert(!sideKeys.includes(key), `ordinary camera exposed ${key}`);
}

const evidence = {
  checkboxLifecycle: {
    discoveredAfterRemoval: selectionAfterRemoval.choices,
    readdedWithStableNativeIds: true,
  },
  importedCameraChoices: discoveredSelection.choices,
  importedCameraIds: [front.nativeId, side.nativeId],
  provider: {
    keys: providerKeys,
    groups: [...new Set(providerSettings.map(setting => setting.group).filter(Boolean))],
  },
  frontDoor: {
    id: front.id,
    keys: frontKeys,
    name: front.name,
    providedInterfaces: front.providedInterfaces,
    type: front.type,
  },
  sideYard: {
    id: side.id,
    keys: sideKeys,
    name: side.name,
    providedInterfaces: side.providedInterfaces,
    type: side.type,
  },
  upstream,
};
if (evidencePath)
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));
sdk.disconnect();
