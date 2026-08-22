# Implementation status

## Version 0.0.2

The provider discovers Frigate cameras through `/api/config` and `/api/go2rtc/streams`. Users select which cameras Scrypted creates. Each camera keeps a stable native id.

Shared Frigate, MQTT, and go2rtc settings live on the provider. Camera name, type, and intercom settings live on each camera. Doorbell event topics appear on Doorbell devices.

Every imported camera implements video, snapshots, motion, online state, and settings. Frigate audio detection adds an audio sensor. Doorbell mode adds press and tamper sensors. Intercom appears when it is enabled and go2rtc is configured.

One MQTT connection handles all selected cameras. The router derives Frigate topics from the API response and subscribes to exact Doorbell topics.

The HomeKit plugin decrypts its AAC-ELD or Opus microphone stream before calling the bridge. The bridge's FFmpeg process decodes that input and encodes a PCMA camera target. It retries with low-delay Opus if go2rtc rejects PCMA. go2rtc reads PCMA directly. The Opus retry uses a copy-only FFmpeg remux inside go2rtc. The bridge handles every codec conversion. Both input paths use a 32-byte probe, zero analysis time, no input buffer, and low-delay flags.

## Verification

`npm run verify:full` runs these checks:

- TypeScript type checking
- Unit and contract tests
- Production build
- Production dependency audit
- go2rtc v1.9.10 and v1.9.14 media tests
- Two-camera Scrypted Core test
- Rebroadcast probes for four streams
- MQTT motion, audio, press, and tamper events
- HomeKit-style Opus source to PCMA camera target
- Direct PCMA routing and copy-only Opus remuxing in go2rtc
- HomeKit setup for Camera and Doorbell devices
- npm publish preview

The Home app checklist is in [docs/HKSV_ACCEPTANCE.md](docs/HKSV_ACCEPTANCE.md).
