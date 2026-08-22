import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const aedesModule = require('aedes');
const createAedes = aedesModule.Aedes?.createBroker?.bind(aedesModule.Aedes)
  || aedesModule.createBroker;
if (!createAedes)
  throw new Error('unsupported Aedes module shape');

const snapshotPath = process.env.E2E_SNAPSHOT_PATH;
const tonePath = process.env.E2E_TONE_PATH;
if (!snapshotPath || !tonePath)
  throw new Error('E2E_SNAPSHOT_PATH and E2E_TONE_PATH are required');

const snapshot = await readFile(snapshotPath);
const tone = await readFile(tonePath);
const frigateConfig = {
  mqtt: { topic_prefix: 'frigate' },
  cameras: {
    front_door: {
      enabled: true,
      audio: { enabled: true },
      detect: { width: 640, height: 360 },
      live: {
        streams: {
          'Main Stream': 'Scrypted-E2E-G4',
          'Low Resolution Stream': 'Scrypted-E2E-G4-Sub',
        },
      },
      ffmpeg: {
        inputs: [
          { path: 'rtsp://127.0.0.1:8554/Scrypted-E2E-G4', roles: ['record'] },
          { path: 'rtsp://127.0.0.1:8554/Scrypted-E2E-G4-Sub', roles: ['detect', 'audio'] },
        ],
      },
    },
    side_yard: {
      enabled: true,
      audio: { enabled: false },
      detect: { width: 640, height: 360 },
      live: {
        streams: {
          'Main Stream': 'Scrypted-E2E-Side',
          'Low Resolution Stream': 'Scrypted-E2E-Side-Sub',
        },
      },
      ffmpeg: {
        inputs: [
          { path: 'rtsp://127.0.0.1:8554/Scrypted-E2E-Side', roles: ['record'] },
          { path: 'rtsp://127.0.0.1:8554/Scrypted-E2E-Side-Sub', roles: ['detect'] },
        ],
      },
    },
  },
};
const go2rtcStreams = {
  'Scrypted-E2E-G4': streamInfo(1920, 1080, 'aac', 16000),
  'Scrypted-E2E-G4-Sub': streamInfo(640, 360),
  'Scrypted-E2E-Side': streamInfo(1280, 720),
  'Scrypted-E2E-Side-Sub': streamInfo(640, 360),
};
const broker = await createAedes();
const mqtt = createTcpServer(broker.handle);
const http = createHttpServer((request, response) => {
  if (request.url === '/snapshot.jpg'
    || request.url === '/api/front_door/latest.jpg'
    || request.url === '/api/side_yard/latest.jpg') {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': snapshot.length,
      'Content-Type': 'image/jpeg',
    });
    response.end(snapshot);
    return;
  }
  if (request.url === '/tone.wav') {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': tone.length,
      'Content-Type': 'audio/wav',
    });
    response.end(tone);
    return;
  }
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"status":"ok"}');
    return;
  }
  if (request.url === '/api/version') {
    sendJson(response, { version: '0.17.2-e2e' });
    return;
  }
  if (request.url === '/api/config') {
    sendJson(response, frigateConfig);
    return;
  }
  if (request.url === '/api/go2rtc/streams') {
    sendJson(response, go2rtcStreams);
    return;
  }
  response.writeHead(404);
  response.end();
});

await Promise.all([
  new Promise((resolve, reject) => mqtt.once('error', reject).listen(11883, '127.0.0.1', resolve)),
  new Promise((resolve, reject) => http.once('error', reject).listen(11885, '127.0.0.1', resolve)),
]);

console.log('fixture-services ready mqtt=127.0.0.1:11883 http=127.0.0.1:11885');

async function close() {
  await Promise.allSettled([
    new Promise(resolve => mqtt.close(resolve)),
    new Promise(resolve => http.close(resolve)),
    broker.close(),
  ]);
}

process.once('SIGINT', () => void close().finally(() => process.exit()));
process.once('SIGTERM', () => void close().finally(() => process.exit()));

function sendJson(response, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    'Content-Type': 'application/json',
  });
  response.end(body);
}

function streamInfo(width, height, audioCodec, sampleRate) {
  const receivers = [{ codec: { codec_type: 'video', codec_name: 'h264', width, height } }];
  if (audioCodec)
    receivers.push({ codec: { codec_type: 'audio', codec_name: audioCodec, sample_rate: sampleRate } });
  return { producers: [{ receivers }] };
}
