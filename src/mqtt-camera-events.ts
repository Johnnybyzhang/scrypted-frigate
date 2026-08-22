import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import type { CameraConfig, CameraStateSink, ProviderConfig } from './types';

export function parseBinaryPayload(payload: Buffer | string): boolean | undefined {
  const normalized = payload.toString().trim().toLowerCase();
  if (['on', 'true', '1', 'active', 'online', 'yes'].includes(normalized))
    return true;
  if (['off', 'false', '0', 'inactive', 'offline', 'no'].includes(normalized))
    return false;
  return undefined;
}

export function extractEventKey(payload: Buffer): string | undefined {
  if (!payload.length || payload.length > 64 * 1024)
    return undefined;
  try {
    const parsed = JSON.parse(payload.toString()) as Record<string, unknown>;
    for (const key of ['id', 'event_id', 'timestamp', 'time']) {
      const value = parsed[key];
      if (typeof value === 'string' || typeof value === 'number')
        return `${key}:${String(value)}`;
    }
  }
  catch {
    return undefined;
  }
  return undefined;
}

export interface CameraMqttRoute {
  cameraName: string;
  audioDetection: boolean;
  config: CameraConfig;
  sink: CameraStateSink;
}

export interface MqttBridgeEventsOptions {
  connect?: typeof mqtt.connect;
  onLog?: (message: string) => void;
}

export class MqttBridgeEvents {
  private client?: MqttClient;
  private connectionGeneration = 0;

  constructor(
    private readonly providerConfig: ProviderConfig,
    private readonly topicPrefix: string,
    private readonly routes: CameraMqttRoute[],
    private readonly options: MqttBridgeEventsOptions = {},
  ) {}

  start(): void {
    if (!this.providerConfig.mqttUrl || this.client || !this.routes.length)
      return;
    const connect = this.options.connect || mqtt.connect;
    const clientOptions: IClientOptions = {
      username: this.providerConfig.mqttUsername || undefined,
      password: this.providerConfig.mqttPassword || undefined,
      clientId: `scrypted-frigate-${Math.random().toString(16).slice(2, 10)}`,
      clean: true,
      keepalive: 30,
      connectTimeout: 10_000,
      reconnectPeriod: 1000,
      resubscribe: true,
    };
    const client = connect(this.providerConfig.mqttUrl, clientOptions);
    this.client = client;
    client.on('connect', () => {
      this.connectionGeneration += 1;
      this.setTransportState(true);
      const topics = this.topics();
      if (topics.length) {
        client.subscribe(topics, { qos: 1 }, error => {
          if (error)
            this.options.onLog?.(`MQTT subscription failed: ${error.message}`);
        });
      }
    });
    client.on('reconnect', () => this.setTransportState(false));
    client.on('close', () => this.setTransportState(false));
    client.on('offline', () => this.setTransportState(false));
    client.on('error', error => this.options.onLog?.(`MQTT error: ${error.message}`));
    client.on('message', (topic, payload, packet) => this.onMessage(topic, payload, packet));
  }

  stop(): void {
    const client = this.client;
    this.client = undefined;
    this.setTransportState(false);
    if (client) {
      client.removeAllListeners();
      client.on('error', error => this.options.onLog?.(`MQTT shutdown error: ${error.message}`));
      client.end(true);
    }
  }

  onMessage(topic: string, payload: Buffer, packet: { retain: boolean; dup?: boolean; messageId?: number }): void {
    if (payload.length > 64 * 1024) {
      this.options.onLog?.(`Ignored oversized MQTT payload on ${topic}`);
      return;
    }
    const globalAvailability = `${this.topicPrefix}/available`;
    if (topic === globalAvailability) {
      const value = parseBinaryPayload(payload);
      if (value !== undefined)
        this.routes.forEach(route => route.sink.setFrigateAvailable(value));
      return;
    }

    for (const route of this.routes) {
      if (topic === `${this.topicPrefix}/${route.cameraName}/motion`) {
        const value = parseBinaryPayload(payload);
        if (value !== undefined)
          route.sink.setMotion(value);
        continue;
      }
      if (route.audioDetection && topic === `${this.topicPrefix}/${route.cameraName}/audio/all`) {
        const value = parseBinaryPayload(payload);
        if (value !== undefined)
          route.sink.setAudio(value);
        continue;
      }
      if (route.config.deviceType !== 'Doorbell')
        continue;
      if (route.config.deviceAvailabilityTopic && topic === route.config.deviceAvailabilityTopic) {
        const value = parseBinaryPayload(payload);
        if (value !== undefined)
          route.sink.setDeviceAvailable(value);
        continue;
      }
      if (route.config.doorbellTopic && topic === route.config.doorbellTopic) {
        if (!packet.retain && !(packet.dup && packet.messageId === undefined))
          route.sink.pulseDoorbell(this.edgeEventKey(payload, packet));
        continue;
      }
      if (route.config.tamperTopic && topic === route.config.tamperTopic
        && !packet.retain && !(packet.dup && packet.messageId === undefined))
        route.sink.pulseTamper(this.edgeEventKey(payload, packet));
    }
  }

  private topics(): string[] {
    const topics = [`${this.topicPrefix}/available`];
    for (const route of this.routes) {
      topics.push(`${this.topicPrefix}/${route.cameraName}/motion`);
      if (route.audioDetection)
        topics.push(`${this.topicPrefix}/${route.cameraName}/audio/all`);
      if (route.config.deviceType === 'Doorbell') {
        topics.push(
          route.config.deviceAvailabilityTopic,
          route.config.doorbellTopic,
          route.config.tamperTopic,
        );
      }
    }
    return [...new Set(topics.filter(Boolean))];
  }

  private setTransportState(connected: boolean): void {
    this.routes.forEach(route => route.sink.setMqttConnected(connected));
  }

  private edgeEventKey(payload: Buffer, packet: { messageId?: number }): string | undefined {
    return extractEventKey(payload)
      || (packet.messageId === undefined
        ? undefined
        : `mqtt:${this.connectionGeneration}:${packet.messageId}`);
  }
}
