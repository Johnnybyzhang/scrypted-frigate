# Bare native E2E validation

Neither harness uses Docker Desktop, Apple Container, Docker, another OCI runtime, a G4 key, or a physical camera. FFmpeg-generated sources exercise the same go2rtc inputs the plugin sees in production.

## Full Scrypted Core and HomeKit boundary

Install the pinned harness dependencies once, then run:

```sh
npm ci --prefix hardware/e2e/scrypted-core
npm run test:e2e:scrypted-core
```

The harness starts isolated native processes on loopback:

- Scrypted Server 0.143.0 and current compatible Core UI;
- HomeKit, Rebroadcast/Prebuffer, WebRTC, Snapshot, and Diagnostics plugins;
- go2rtc v1.9.14;
- a Frigate API fixture with `front_door` and `side_yard`;
- H.264/AAC and H.264-only main/sub FFmpeg sessions;
- an MQTT broker and snapshot/talkback fixtures;
- the locally built Frigate Camera Bridge plugin.

It then proves:

1. both Frigate cameras appear in the provider selector;
2. selecting both creates stable child ids;
3. deselecting `side_yard` removes only that Scrypted child while the Frigate inventory remains; reselecting restores the same id;
4. provider settings contain global connections but no per-camera topics or stream fields;
5. camera pages contain no broker/API credentials; Doorbell fields exist only on the Doorbell;
6. both main/sub streams and snapshots traverse Scrypted;
7. Rebroadcast returns four loopback RTSP endpoints and FFprobe confirms codecs and resolution;
8. shared MQTT routes motion for both cameras, audio only for the audio-enabled camera, and doorbell/tamper only for the Doorbell;
9. Scrypted `Intercom` reaches go2rtc's backchannel sink as PCMA mono 8 kHz;
10. both children accept the HomeKit mixin and standalone accessory configuration with the correct camera/doorbell surfaces.

Logs and JSON/media evidence are preserved under the run directory printed at completion in `.artifacts/scrypted-core-e2e/`. The script stops every process it started.

Visual WebUI qualification uses the same running stack and confirms provider discovery controls, conditional device settings, and live frames. It is an interactive check because the management UI is not included in the publishable plugin package.

## go2rtc compatibility matrix

```sh
npm run test:e2e:go2rtc:matrix
```

This smaller harness repeats the media/backchannel contract on go2rtc v1.9.10 and v1.9.14: H.264 1280x720 + AAC mono 16 kHz via RTSP, followed by the real `Go2rtcClient`, `POST /api/streams`, a PCMA mono 8 kHz exec sink, stop, WAV conversion, and probe.

## Boundary

These checks complete at Scrypted Core and the HomeKit plugin. They do not claim Apple Home pairing, an iCloud HKSV timeline recording, physical G4 speaker audibility, or mutation of any real camera/server. Those remain explicit acceptance work in [HKSV acceptance](HKSV_ACCEPTANCE.md).
