# E2E validation

The tests use native FFmpeg, go2rtc, MQTT, and Scrypted processes on loopback addresses. Camera video comes from FFmpeg test patterns.

## Scrypted Core test

Install the pinned test dependencies once:

```sh
npm ci --prefix e2e/scrypted-core
```

Run the test:

```sh
npm run test:e2e:scrypted-core
```

The script starts Scrypted Server 0.143.0 and installs the Core UI, HomeKit, Rebroadcast, WebRTC, Snapshot, and Diagnostics plugins. It also starts go2rtc v1.9.14, a two-camera Frigate API fixture, an MQTT broker, and five FFmpeg video producers.

The test checks these operations:

1. Frigate returns `front_door` and `side_yard` through its API.
2. Selecting both names creates two Scrypted devices.
3. Removing `side_yard` removes its Scrypted device. Adding it again restores the same native id.
4. Provider and camera settings appear on the correct device pages.
5. The Doorbell has press and tamper controls. The Camera does not.
6. The Frigate API reports an active HEVC producer while the configured H.264 producer has no receiver metadata. The raw bridge input still requests `video=h264&audio`.
7. Both cameras return main and sub streams plus snapshots.
8. An empty go2rtc inventory and a temporary inventory error leave both configured cameras online.
9. Rebroadcast creates four RTSP URLs. FFprobe confirms H.264 and checks each resolution.
10. After every FFprobe viewer closes, both cameras remain online. go2rtc still has one Scrypted consumer and an active H.264 producer for all four prebuffered streams.
11. MQTT updates motion on both cameras, audio on the enabled camera, and press and tamper on the Doorbell.
12. Talkback reads a HomeKit-style Opus source, encodes PCMA in the bridge, routes it directly through go2rtc, and writes the camera-facing payload.
13. HomeKit loads both cameras in standalone accessory mode.

The script prints its artifact directory. That directory contains process logs, stream probes, settings data, snapshot sizes, talkback data, the Scrypted runtime report, and `viewer-close.json` with the post-disconnect Scrypted and go2rtc state.

## go2rtc version test

```sh
npm run test:e2e:go2rtc:matrix
```

This test runs against go2rtc v1.9.10 and v1.9.14. It checks H.264 and AAC forward media, the stream-to-camera API, direct PCMA/WAV routing, and the captured PCMA payload. The unit suite checks the exact low-latency FFmpeg arguments for AAC-ELD and Opus inputs plus PCMA and Opus targets.

## HomeKit test

The local test confirms the HomeKit plugin accepts both Scrypted devices and builds the expected Camera and Doorbell accessories. Pairing and HKSV recording checks are listed in [HomeKit and HKSV acceptance](HKSV_ACCEPTANCE.md).
