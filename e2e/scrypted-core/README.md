# Scrypted Core E2E

This test starts an isolated Scrypted Core server on the host. It adds a Doorbell and a Camera from a two-camera Frigate API fixture.

The video sources use FFmpeg test patterns. The test installs HomeKit, Rebroadcast, WebRTC, Snapshot, and Diagnostics. It checks camera selection, stable ids, settings, live streams, snapshots, MQTT events, talkback, and HomeKit setup.

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
