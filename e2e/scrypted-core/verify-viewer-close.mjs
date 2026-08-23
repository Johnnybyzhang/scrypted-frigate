import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { connectScryptedClient } from '@scrypted/client';

const baseUrl = process.env.SCRYPTED_E2E_URL || 'https://127.0.0.1:10443';
const evidencePath = process.env.SCRYPTED_E2E_EVIDENCE;

const originalLog = console.log;
console.log = () => {};
const sdk = await connectScryptedClient({
  baseUrl,
  pluginId: '@scrypted/core',
  transports: ['polling', 'websocket'],
});
console.log = originalLog;

const devices = Object.keys(sdk.systemManager.getSystemState())
  .map(id => sdk.systemManager.getDeviceById(id))
  .filter(Boolean);
const cameras = devices.filter(device => device.pluginId === '@johnnybyzhang/scrypted-frigate' && device.nativeId);
assert.equal(cameras.length, 2);
for (const camera of cameras)
  assert.equal(camera.online, true, `${camera.name} became unavailable after the last viewer disconnected`);

const go2rtcResponse = await fetch('http://127.0.0.1:11984/api/streams');
assert.equal(go2rtcResponse.ok, true, 'go2rtc stream state could not be read');
const go2rtc = await go2rtcResponse.json();
const expectedStreams = [
  'Scrypted-E2E-Doorbell',
  'Scrypted-E2E-Doorbell-Sub',
  'Scrypted-E2E-Side',
  'Scrypted-E2E-Side-Sub',
];
for (const streamName of expectedStreams) {
  const stream = go2rtc[streamName];
  assert(stream, `go2rtc stream is missing after viewer close: ${streamName}`);
  assert(stream.consumers?.some(consumer => consumer.user_agent === 'Scrypted'),
    `Scrypted dropped its persistent go2rtc consumer: ${streamName}`);
  assert(stream.producers?.some(producer => producer.receivers?.some(receiver => receiver.codec?.codec_name === 'h264')),
    `the H.264 producer stopped after viewer close: ${streamName}`);
}
const evidence = {
  cameras: cameras.map(camera => ({ name: camera.name, online: camera.online })),
  persistentStreams: expectedStreams,
  go2rtc,
};
if (evidencePath)
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));
sdk.disconnect();
