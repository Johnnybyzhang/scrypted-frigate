# Implementation status

## Version 0.0.5

The provider discovers Frigate cameras through `/api/config` and `/api/go2rtc/streams`. Users select which cameras Scrypted creates. Each camera keeps a stable native id.

Discovery inspects each go2rtc producer's receiver tracks for dimensions and forward audio. Every RTSP URL carries a `video=h264&audio` filter, including when the H.264 producer has not started and the API reports only HEVC. Backchannel sender codecs do not appear as forward camera media.

Frigate's configured stream names remain valid when go2rtc has no active metadata. A temporary go2rtc inventory error leaves cameras online and reports a warning. Two failed Frigate refreshes keep the last known state; the third consecutive failure marks cameras offline.

The bridge marks its streams as local. Scrypted Rebroadcast prebuffers them and keeps the go2rtc connection open after the last viewer closes. The E2E test checks the camera `Online` state and the active Scrypted consumers in go2rtc after every downstream FFprobe session ends.

Shared Frigate, MQTT, and go2rtc settings live on the provider. Camera name, type, and intercom settings live on each camera. Doorbell event topics appear on Doorbell devices.

Every imported camera implements video, snapshots, motion, online state, and settings. Frigate audio detection adds an audio sensor. Doorbell mode adds press and tamper sensors. Intercom appears when it is enabled and go2rtc is configured.

One MQTT connection handles all selected cameras. The router derives Frigate topics from the API response and subscribes to exact Doorbell topics. Frigate motion follows retained `ON` and `OFF` levels on `<prefix>/<camera>/motion`. Doorbell and tamper inputs accept plain active values or a per-device payload regex. Inactive values, including `tamper_alarm:0`, do not create edge events.

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
- Lazy H.264 producer selection when the API reports only active HEVC
- Stable camera availability with an idle or temporarily unreadable go2rtc inventory
- Persistent Rebroadcast consumers after every downstream viewer closes
- MQTT motion `ON` and `OFF`, audio, plain edge payloads, JSON regex matches, and inactive tamper reports
- HomeKit-style Opus source to PCMA camera target
- Direct PCMA routing and copy-only Opus remuxing in go2rtc
- HomeKit setup for Camera and Doorbell devices
- npm publish preview

The Home app checklist is in [docs/HKSV_ACCEPTANCE.md](docs/HKSV_ACCEPTANCE.md).
