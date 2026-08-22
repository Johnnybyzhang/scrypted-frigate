import { EventEmitter } from 'node:events';
import { ScryptedDeviceType } from '@scrypted/sdk';
import { describe, expect, it } from 'vitest';
import { extractEventKey, MqttBridgeEvents, parseBinaryPayload } from '../src/mqtt-camera-events';
import { cameraConfig, cameraSink, providerConfig } from './fixtures';

describe('MQTT payload parsing', () => {
  it.each([
    ['ON', true],
    ['true', true],
    ['1', true],
    ['offline', false],
    ['OFF', false],
    ['unknown', undefined],
  ])('parses %s', (payload, expected) => {
    expect(parseBinaryPayload(payload)).toBe(expected);
  });

  it('extracts a stable event key from normalized event JSON', () => {
    expect(extractEventKey(Buffer.from('{"timestamp":"2026-08-22T12:00:00Z","kind":"doorbell_ring"}')))
      .toBe('timestamp:2026-08-22T12:00:00Z');
  });

  it('rejects invalid or oversized event JSON', () => {
    expect(extractEventKey(Buffer.from('not-json'))).toBeUndefined();
    expect(extractEventKey(Buffer.alloc(64 * 1024 + 1))).toBeUndefined();
  });
});

describe('MqttBridgeEvents routing', () => {
  it('contains late transport errors after a stopped shared connection', () => {
    const front = cameraSink();
    const client = Object.assign(new EventEmitter(), {
      end: () => undefined,
      subscribe: () => undefined,
    });
    const logs: string[] = [];
    const events = new MqttBridgeEvents(providerConfig(), 'frigate', [{
      cameraName: 'front_door',
      audioDetection: true,
      config: cameraConfig(),
      sink: front.sink,
    }], {
      connect: (() => client) as never,
      onLog: message => logs.push(message),
    });

    events.start();
    events.stop();

    expect(() => client.emit('error', new Error('connack timeout'))).not.toThrow();
    expect(logs).toEqual(['MQTT shutdown error: connack timeout']);
  });

  it('derives Frigate topics and routes two cameras over one MQTT client', () => {
    const front = cameraSink();
    const side = cameraSink();
    const events = new MqttBridgeEvents(providerConfig(), 'site-frigate', [
      { cameraName: 'front_door', audioDetection: true, config: cameraConfig(), sink: front.sink },
      {
        cameraName: 'side_yard',
        audioDetection: false,
        config: cameraConfig({ deviceType: ScryptedDeviceType.Camera }),
        sink: side.sink,
      },
    ]);

    events.onMessage('site-frigate/front_door/motion', Buffer.from('ON'), { retain: true });
    events.onMessage('site-frigate/side_yard/motion', Buffer.from('ON'), { retain: true });
    events.onMessage('site-frigate/front_door/audio/all', Buffer.from('ON'), { retain: false });
    events.onMessage('site-frigate/side_yard/audio/all', Buffer.from('ON'), { retain: false });
    events.onMessage('site-frigate/available', Buffer.from('online'), { retain: true });
    events.onMessage('site/front_door/availability', Buffer.from('offline'), { retain: true });

    expect(front.calls.motion).toEqual([true]);
    expect(side.calls.motion).toEqual([true]);
    expect(front.calls.audio).toEqual([true]);
    expect(side.calls.audio).toEqual([]);
    expect(front.calls.frigateAvailable).toEqual([true]);
    expect(side.calls.frigateAvailable).toEqual([true]);
    expect(front.calls.deviceAvailable).toEqual([false]);
    expect(side.calls.deviceAvailable).toEqual([]);
  });

  it('hides doorbell routing from ordinary cameras and rejects retained edges', () => {
    const front = cameraSink();
    const side = cameraSink();
    const events = new MqttBridgeEvents(providerConfig(), 'frigate', [
      { cameraName: 'front_door', audioDetection: true, config: cameraConfig(), sink: front.sink },
      {
        cameraName: 'side_yard',
        audioDetection: false,
        config: cameraConfig({
          deviceType: ScryptedDeviceType.Camera,
          doorbellTopic: 'site/side_yard/doorbell',
          tamperTopic: 'site/side_yard/tamper',
        }),
        sink: side.sink,
      },
    ]);
    const payload = Buffer.from('{"id":"press-1"}');

    events.onMessage('site/front_door/doorbell', payload, { retain: true });
    events.onMessage('site/front_door/tamper', payload, { retain: true });
    events.onMessage('site/front_door/doorbell', payload, { retain: false });
    events.onMessage('site/front_door/tamper', payload, { retain: false });
    events.onMessage('site/side_yard/doorbell', payload, { retain: false });

    expect(front.calls.doorbell).toEqual(['id:press-1']);
    expect(front.calls.tamper).toEqual(['id:press-1']);
    expect(side.calls.doorbell).toEqual([]);
    expect(side.calls.tamper).toEqual([]);
  });

  it('provides stable MQTT QoS identity when event JSON has no ID', () => {
    const front = cameraSink();
    const events = new MqttBridgeEvents(providerConfig(), 'frigate', [{
      cameraName: 'front_door',
      audioDetection: true,
      config: cameraConfig(),
      sink: front.sink,
    }]);
    const payload = Buffer.from('{"kind":"doorbell_ring","action":"button_click"}');

    events.onMessage('site/front_door/doorbell', payload, { retain: false, dup: false, messageId: 41 });
    events.onMessage('site/front_door/doorbell', payload, { retain: false, dup: true, messageId: 41 });
    events.onMessage('site/front_door/doorbell', payload, { retain: false, dup: false, messageId: 42 });

    expect(front.calls.doorbell).toEqual(['mqtt:0:41', 'mqtt:0:41', 'mqtt:0:42']);
  });
});
