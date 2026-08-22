import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { Go2rtcClient } from '../src/go2rtc-client';
import { go2rtcConfig } from './fixtures';

const enabled = Boolean(process.env.GO2RTC_E2E_URL);

describe.skipIf(!enabled)('live go2rtc intercom boundary', () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterAll(async () => closeServer?.());

  it('streams a live HTTP source through go2rtc to the configured backchannel', async () => {
    const tonePath = process.env.GO2RTC_E2E_TONE!;
    const talkbackBase = process.env.GO2RTC_E2E_TALKBACK!;
    const server = createServer((request, response) => {
      if (request.url !== '/intercom.wav') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'audio/wav',
      });
      const tone = readFileSync(tonePath);
      let offset = 0;
      const timer = setInterval(() => {
        if (offset >= tone.length) {
          clearInterval(timer);
          response.end();
          return;
        }
        const next = Math.min(tone.length, offset + 1600);
        response.write(tone.subarray(offset, next));
        offset = next;
      }, 50);
      response.once('close', () => clearInterval(timer));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    closeServer = () => new Promise(resolve => server.close(() => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('test HTTP server has no TCP address');

    const client = new Go2rtcClient(go2rtcConfig({
      apiUrl: process.env.GO2RTC_E2E_URL!,
      streamName: process.env.GO2RTC_E2E_STREAM!,
    }));
    await client.play(`http://127.0.0.1:${address.port}/intercom.wav`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    await client.stop();

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (existsSync(`${talkbackBase}.alaw`) && statSync(`${talkbackBase}.alaw`).size > 0)
        break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(existsSync(`${talkbackBase}.alaw`)).toBe(true);
    expect(statSync(`${talkbackBase}.alaw`).size).toBeGreaterThan(0);
  }, 15_000);
});
