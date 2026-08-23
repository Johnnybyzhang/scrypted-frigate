# Scrypted Core E2E

This test starts an isolated Scrypted Core server on the host. It adds a Doorbell and a Camera from a two-camera Frigate API fixture.

The video sources use FFmpeg test patterns. The test installs HomeKit, Rebroadcast, WebRTC, Snapshot, and Diagnostics. It checks camera selection, stable ids, settings, live streams, snapshots, MQTT events, talkback, and HomeKit setup.

The main go2rtc stream puts an HEVC FFmpeg producer before a lazy H.264 producer. The Frigate API fixture exposes receiver metadata only for HEVC. The test checks the bridge's raw `video=h264&audio` RTSP request, then uses FFprobe to confirm H.264 after Rebroadcast.

The fixture can return an empty go2rtc inventory or a temporary 503 response. Both cases must leave configured cameras online. After FFprobe closes all four Rebroadcast viewers, the test confirms that Scrypted still reports both cameras online and that go2rtc still has the four Scrypted prebuffer consumers with active H.264 producers.

The talkback source is Opus, matching one HomeKit negotiation path after the HomeKit plugin decrypts SRTP. The bridge decodes it and streams PCMA/WAV to go2rtc. The test saves the PCMA payload and rejects any go2rtc log that shows a second FFmpeg talkback process.

Install dependencies:

```sh
npm ci --prefix e2e/scrypted-core
```

Run the test:

```sh
npm run test:e2e:scrypted-core
```

The script prints the artifact directory when it finishes.
