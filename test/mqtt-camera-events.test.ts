import { EventEmitter } from 'node:events';
import { ScryptedDeviceType } from '@scrypted/sdk';
import { describe, expect, it } from 'vitest';
import {
  extractEventKey,
  frigateMotionTopic,
  matchesTriggerPayload,
  MqttBridgeEvents,
  parseBinaryPayload,
  parseFrigateMotionPayload,
} from '../src/mqtt-camera-events';
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

  it('preserves Frigate motion ON and OFF as a strict level state', () => {
    expect(parseFrigateMotionPayload('ON')).toBe(true);
    expect(parseFrigateMotionPayload(' off ')).toBe(false);
    expect(parseFrigateMotionPayload('1')).toBeUndefined();
    expect(frigateMotionTopic('frigate', 'Front-Door')).toBe('frigate/Front-Door/motion');
    expect(frigateMotionTopic('/frigate/', 'Front-Door')).toBe('/frigate/Front-Door/motion');
  });

  it('matches common active values and configurable JSON regexes', () => {
    for (const payload of ['ON', '1', 'True', '"ON"'])
      expect(matchesTriggerPayload(payload)).toBe(true);
    for (const payload of ['OFF', '0', 'False', 'active', 'online', 'yes', 'inactive', 'no', ''])
      expect(matchesTriggerPayload(payload)).toBe(false);

    const payload = '{ "event": { "action": "button_click" }, "state": 1 }';
    expect(matchesTriggerPayload(payload, '"action"\\s*:\\s*"button_click"')).toBe(true);
    expect(matchesTriggerPayload(payload, '^\\{"event":\\{"action":"button_click"\\},"state":1\\}$')).toBe(true);
    expect(matchesTriggerPayload(payload, 'doorbell_ring')).toBe(false);
    expect(() => matchesTriggerPayload(payload, '[')).toThrow();
  });

  it('matches the camera doorbell and tamper report payloads', () => {
    const doorbell = '{"time":"2026-08-25T11:48:30.716184535Z","event":{"kind":"doorbell_ring","action":"report","value":1,"raw":{"action":"report","button_click":1}}}';
    const noTamper = '{"time":"2026-08-20T08:09:14.686955864Z","event":{"kind":"tamper","action":"report","value":0,"raw":{"action":"report","tamper_alarm":0}}}';
    const tamper = '{"time":"2026-08-25T12:00:00.000000000Z","event":{"kind":"tamper","action":"report","value":1,"raw":{"action":"report","tamper_alarm":1}}}';

    expect(matchesTriggerPayload(doorbell, '"kind":"doorbell_ring".*"button_click":1')).toBe(true);
    expect(matchesTriggerPayload(noTamper, '"kind":"tamper".*"tamper_alarm":1')).toBe(false);
    expect(matchesTriggerPayload(tamper, '"kind":"tamper".*"tamper_alarm":1')).toBe(true);
    expect(matchesTriggerPayload(doorbell, '"kind":"tamper"')).toBe(false);
    expect(matchesTriggerPayload(tamper, '"kind":"doorbell_ring"')).toBe(false);
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

  it('subscribes to the exact Frigate motion state topic for every camera', () => {
    const front = cameraSink();
    const side = cameraSink();
    const subscriptions: string[][] = [];
    const client = Object.assign(new EventEmitter(), {
      end: () => undefined,
      subscribe: (topics: string[]) => subscriptions.push(topics),
    });
    const events = new MqttBridgeEvents(providerConfig(), 'frigate', [
      { cameraName: 'Front-Door', audioDetection: true, config: cameraConfig(), sink: front.sink },
      {
        cameraName: 'side_yard',
        audioDetection: false,
        config: cameraConfig({ deviceType: ScryptedDeviceType.Camera }),
        sink: side.sink,
      },
    ], { connect: (() => client) as never });

    events.start();
    client.emit('connect');
    events.stop();

    expect(subscriptions).toEqual([expect.arrayContaining([
      'frigate/Front-Door/motion',
      'frigate/side_yard/motion',
    ])]);
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
    events.onMessage('site-frigate/front_door/motion', Buffer.from('OFF'), { retain: true });
    events.onMessage('site-frigate/side_yard/motion', Buffer.from('OFF'), { retain: true });
    events.onMessage('site-frigate/front_door/audio/all', Buffer.from('ON'), { retain: false });
    events.onMessage('site-frigate/side_yard/audio/all', Buffer.from('ON'), { retain: false });
    events.onMessage('site-frigate/available', Buffer.from('online'), { retain: true });
    events.onMessage('site/front_door/availability', Buffer.from('offline'), { retain: true });

    expect(front.calls.motion).toEqual([true, false]);
    expect(side.calls.motion).toEqual([true, false]);
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
      {
        cameraName: 'front_door',
        audioDetection: true,
        config: cameraConfig({
          doorbellTriggerRegex: '"id"\\s*:\\s*"press-1"',
          tamperTriggerRegex: '"id"\\s*:\\s*"press-1"',
        }),
        sink: front.sink,
      },
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

  it('triggers doorbell and tamper only for active or regex-matched payloads', () => {
    const front = cameraSink();
    const events = new MqttBridgeEvents(providerConfig(), 'frigate', [{
      cameraName: 'front_door',
      audioDetection: true,
      config: cameraConfig({
        doorbellTriggerRegex: '"kind":"doorbell_ring".*"button_click":1',
        tamperTriggerRegex: '"kind":"tamper".*"tamper_alarm":1',
      }),
      sink: front.sink,
    }]);

    for (const payload of ['ON', '1', 'True', 'OFF', '0', 'False'])
      events.onMessage('site/front_door/doorbell', Buffer.from(payload), { retain: false });
    events.onMessage('site/front_door/doorbell', Buffer.from('{"event":{"kind":"doorbell_ring","raw":{"button_click":1}}}'), { retain: false });
    events.onMessage('site/front_door/doorbell', Buffer.from('{"event":{"kind":"motion"}}'), { retain: false });
    events.onMessage('site/front_door/tamper', Buffer.from('{ "event": { "kind": "tamper", "raw": { "tamper_alarm": 1 } } }'), { retain: false });
    events.onMessage('site/front_door/tamper', Buffer.from('{ "event": { "kind": "tamper", "raw": { "tamper_alarm": 0 } } }'), { retain: false });
    events.onMessage('site/front_door/tamper', Buffer.from('OFF'), { retain: false });

    expect(front.calls.doorbell).toHaveLength(4);
    expect(front.calls.tamper).toHaveLength(1);
  });

  it('ignores an invalid edge regex and reports the camera setting', () => {
    const front = cameraSink();
    const logs: string[] = [];
    const events = new MqttBridgeEvents(providerConfig(), 'frigate', [{
      cameraName: 'front_door',
      audioDetection: true,
      config: cameraConfig({ doorbellTriggerRegex: '[' }),
      sink: front.sink,
    }], { onLog: message => logs.push(message) });

    events.onMessage('site/front_door/doorbell', Buffer.from('{"action":"button_click"}'), { retain: false });

    expect(front.calls.doorbell).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('Invalid doorbell trigger regex for front_door');
  });

  it('provides stable MQTT QoS identity when event JSON has no ID', () => {
    const front = cameraSink();
    const events = new MqttBridgeEvents(providerConfig(), 'frigate', [{
      cameraName: 'front_door',
      audioDetection: true,
      config: cameraConfig({ doorbellTriggerRegex: 'doorbell_ring' }),
      sink: front.sink,
    }]);
    const payload = Buffer.from('{"kind":"doorbell_ring","action":"button_click"}');

    events.onMessage('site/front_door/doorbell', payload, { retain: false, dup: false, messageId: 41 });
    events.onMessage('site/front_door/doorbell', payload, { retain: false, dup: true, messageId: 41 });
    events.onMessage('site/front_door/doorbell', payload, { retain: false, dup: false, messageId: 42 });

    expect(front.calls.doorbell).toEqual(['mqtt:0:41', 'mqtt:0:41', 'mqtt:0:42']);
  });
});
