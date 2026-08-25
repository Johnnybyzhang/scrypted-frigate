# HomeKit and HKSV acceptance

Run the local Scrypted test first:

```sh
npm run test:e2e:scrypted-core
```

## Scrypted checks

For every imported camera:

- Open the main and sub streams in the Scrypted UI.
- Close every live viewer. Confirm the camera stays online and Rebroadcast keeps the selected streams prebuffered.
- Request a snapshot.
- Trigger motion through MQTT.
- Confirm `ON` sets motion and `OFF` clears it on `<prefix>/<camera>/motion`.
- Confirm the device remains online after a Frigate refresh.
- Enable the HomeKit mixin in standalone accessory mode.

For a Doorbell:

- Trigger press and tamper events through their configured MQTT topics.
- Confirm plain active values and each configured JSON regex trigger. Confirm `OFF`, `0`, `false`, and `tamper_alarm:0` do not trigger.
- Confirm retained press and tamper messages are ignored.
- Start talkback with AAC-ELD and Opus HomeKit sessions. Confirm the camera receives PCMA or the Opus fallback.
- Stop talkback and confirm the bridge FFmpeg process exits and the go2rtc playback route clears.

## Home app checks

- Pair each camera as a standalone accessory.
- Open local and remote live video.
- Close and reopen live video. A fresh downstream RTSP session is expected; the upstream go2rtc consumer should not restart.
- Check camera audio and snapshot refresh.
- Confirm a Camera has no doorbell controls.
- Press each Doorbell twenty times and count twenty Home notifications.
- Include two quick presses in that count.
- Run ten start, talk, and stop cycles. Listen at the camera for each cycle.
- Press the Doorbell during talkback and confirm one notification.

## HKSV checks

- Enable Stream and Recording.
- Select all-motion recording for the test.
- Trigger motion and confirm Scrypted reports it.
- Confirm the HomeKit plugin starts a recording session.
- Open the matching clip in the Home timeline and check its audio.
- Repeat after MQTT reconnect, Frigate restart, go2rtc restart, plugin reload, Scrypted restart, and Home Hub handoff.
