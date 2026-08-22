# Frigate Camera Bridge for Scrypted Core

This environment-agnostic Scrypted `DeviceProvider` imports cameras discovered through the Frigate API and presents them as feature-complete Scrypted Core cameras for the HomeKit/HKSV plugin. It does not target Scrypted NVR and it does not mirror Frigate's recordings, reviews, objects, exports, or PTZ controls.

The same plugin package runs in any supported Scrypted host—native Node.js, Docker, Apple Container, or another OCI environment—without runtime detection, host paths, container APIs, or service orchestration. Development and qualification here are deliberately bare native processes; Docker Desktop is never used.

## Install in Scrypted

In the Scrypted management console, open **Plugins**, choose **Install Plugin**, and install the npm package:

```text
@johnnybyzhang/scrypted-frigate
```

The installed provider is displayed as **Frigate Camera Bridge**.

## Camera discovery and lifecycle

The provider reads Frigate's `/api/config` and `/api/go2rtc/streams` endpoints. Its **Imported Cameras** multi-select lists every Frigate camera; selecting a camera adds one stable Scrypted child and deselecting it removes only that child. The Frigate camera and go2rtc configuration are never changed.

Stream names, main/sub roles, resolutions, codecs, audio-detection availability, MQTT topic prefix, snapshots, and default RTSP/go2rtc addresses are derived from those API responses. A shared RTSP restream-base override remains available for reverse-proxy or split-host deployments, but there are no manual per-camera stream URL fields.

## Scrypted surface

Every imported child exposes `VideoCamera`, `Camera`, `MotionSensor`, `Online`, and `Settings`.

- `AudioSensor` appears only when Frigate enables audio detection for that camera.
- `BinarySensor` and `TamperSensor` appear only when the child is configured as a Doorbell.
- `Intercom` appears only when enabled for that camera and a go2rtc API endpoint is available.
- Main/sub video, snapshots, motion/audio state, and intercom operate independently so a single transport outage does not remove the child.

The provider derives Frigate MQTT topics as `<topic_prefix>/available`, `<topic_prefix>/<camera>/motion`, and, when applicable, `<topic_prefix>/<camera>/audio/all`. They are intentionally not configuration fields. A Doorbell may additionally map one external press topic, one external tamper topic, and optional device availability.

## Configuration placement

Provider settings contain only shared connections and discovery:

| Group | Settings |
| --- | --- |
| Frigate | API URL/token and optional shared RTSP restream-base override |
| Cameras | Refresh action, discovered-camera selector, and discovery status |
| MQTT | One broker URL and credential set shared by all imported cameras |
| Talkback | One go2rtc API URL and credential set shared by intercom-enabled cameras |

Each imported camera contains only camera-specific behavior:

| Camera kind | Settings |
| --- | --- |
| All cameras | Read-only discovered stream information, Scrypted name, Camera/Doorbell type, and intercom enablement |
| Doorbell only | External availability, press, and tamper topics plus pulse durations |

Ordinary cameras do not display or subscribe to doorbell/tamper settings. Camera pages never display Frigate, MQTT-broker, or go2rtc credentials.

## Development and validation

The ordinary native workflow is:

```sh
npm ci
npm ci --prefix hardware/e2e/scrypted-core
npm run verify
npm run test:e2e:go2rtc:matrix
npm run test:e2e:scrypted-core
npm run package:inspect
```

The first go2rtc E2E run fetches only the required upstream tags into ignored `.artifacts/` storage. Set `GO2RTC_SOURCE_DIR` to reuse an existing go2rtc git checkout.

`test:e2e:scrypted-core` creates an isolated native Scrypted Core v0.143.0 runtime, native go2rtc v1.9.14, a two-camera Frigate API fixture, FFmpeg H.264/AAC sources, and a local MQTT broker. It installs Rebroadcast, WebRTC, Snapshot, Diagnostics, and HomeKit, deploys the local plugin, proves select/remove/re-add lifecycle, validates both a Doorbell and an ordinary Camera, probes all Rebroadcast streams, exercises MQTT and talkback, and stops cleanly. Evidence remains under `.artifacts/scrypted-core-e2e/`.

This reaches the Scrypted/HomeKit plugin boundary. It proves HomeKit mixin eligibility and standalone accessory configuration, but it does not claim Apple Home pairing or an HKSV cloud recording. Those physical/user-account checks remain in [HomeKit and HKSV acceptance](docs/HKSV_ACCEPTANCE.md).

## Intercom design

The HomeKit plugin supplies a `MediaObject` to `startIntercom`. The bridge asks Scrypted for its FFmpeg input and FFmpeg path, converts the return channel to PCMA mono 8 kHz, exposes it once through a random local Scrypted endpoint, and calls go2rtc's `POST /api/streams?dst=...&src=...` stream-to-camera API for the API-discovered main stream. Stop or failure removes the ingress token, stops go2rtc playback, and terminates FFmpeg.

go2rtc v1.9.14 requires the configured FFmpeg executable in `exec.allow_paths`. That is a go2rtc deployment policy; the plugin does not edit or weaken it.

## Optional G4 hardware qualification

The synthetic E2E treats every go2rtc input uniformly and needs no camera key. For an actual Aqara G4, the external [hardware harness](hardware/README.md) fetches the current rotated key from the authorized server before physical qualification. Key material never enters plugin storage, logs, or its npm package.
