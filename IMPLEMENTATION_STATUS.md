# Implementation status

## Implemented

- Environment-agnostic Scrypted `DeviceProvider` with Frigate API discovery and stable multi-camera child identifiers.
- Provider-level Frigate, MQTT, and go2rtc connections plus a discovered-camera multi-select for add/remove.
- API-derived go2rtc main/sub stream names and metadata, RTSP restream URLs, Frigate snapshot endpoint, MQTT prefix, motion topics, and audio topics.
- Shared MQTT client/router across imported cameras.
- Per-camera name, Camera/Doorbell type, and intercom enablement; doorbell press/tamper fields and interfaces are conditional.
- `VideoCamera`, `Camera`, `MotionSensor`, `Online`, and `Settings` on every imported camera; conditional `AudioSensor`, `BinarySensor`, `TamperSensor`, and `Intercom`.
- Retained edge rejection, MQTT QoS identity propagation, bounded payloads, pulse deduplication, and transport isolation.
- Scrypted runtime FFmpeg conversion, single-use intercom HTTP ingress, go2rtc stream-to-camera API, and deterministic stop/cleanup.
- External owner-only rotated-key synchronization and read-only G4 preflight tooling. Neither is packaged with or visible to the plugin.

## Verified on 2026-08-23

- Type check and unit/contract suite: 37 passed; one live go2rtc test is intentionally delegated to the E2E harness.
- Fresh native Scrypted Core 0.143.0 with Core UI, HomeKit, Rebroadcast, WebRTC, Snapshot, and Diagnostics plugins.
- Two Frigate cameras discovered from `/api/config` and `/api/go2rtc/streams`.
- Selector lifecycle: both children added, `side_yard` unchecked and removed, discovery inventory preserved, then re-added with the same native id.
- Layout: provider contains no Frigate topic or per-camera stream settings; device pages contain no MQTT broker or shared API credentials; ordinary Camera hides Doorbell Events and doorbell/tamper interfaces.
- Four live Scrypted Rebroadcast paths probed: front 1920x1080 H.264 + AAC 16 kHz and 640x360 H.264; side 1280x720 and 640x360 H.264.
- Scrypted WebUI rendered live video for both imported cameras.
- Frigate-derived MQTT motion on both cameras, audio detection on the enabled camera, and external doorbell/tamper pulses passed.
- Scrypted `Intercom` routed through the plugin and go2rtc to a 4.2-second PCMA 8 kHz capture.
- Both cameras received the HomeKit mixin in standalone accessory mode; the Doorbell exposed the HomeKit doorbell surface while the ordinary camera did not.
- Native go2rtc v1.9.10/v1.9.14 media and backchannel matrix, reproducible build, dependency audit, and package inspection remain part of `verify:full`.

## Proof boundary

The current E2E intentionally ends at the Scrypted Core/HomeKit-plugin boundary. It does not claim Apple Home pairing, physical G4 speaker audibility, or a user-visible HKSV timeline recording. It does not deploy to or mutate a real Frigate/go2rtc/MQTT/G4 service.

Physical G4 key preflight and Apple Home acceptance remain separate, explicit operations. No private key material or local server identity is part of the public package or repository.
