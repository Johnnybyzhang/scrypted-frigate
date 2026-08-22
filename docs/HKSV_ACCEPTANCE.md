# HomeKit and HKSV acceptance

The automated E2E ends safely at the Scrypted Core/HomeKit-plugin boundary. Apple Home pairing is a separate, user-approved acceptance operation.

## Scrypted boundary — automated

For every imported camera:

- stable identity survives deselect/reselect;
- main/sub live paths, snapshots, motion, Online, Rebroadcast, and WebUI live view work;
- HomeKit mixin is active in standalone accessory mode;
- HomeKit-visible interfaces match the device type.

For an audio-enabled Doorbell:

- `AudioSensor`, `BinarySensor`, `TamperSensor`, and `Intercom` are present;
- derived Frigate motion/audio and configured external press/tamper events work;
- Scrypted intercom audio reaches the go2rtc backchannel sink.

For an ordinary Camera:

- doorbell/tamper settings and interfaces are absent;
- intercom and audio detection are absent unless explicitly enabled/available;
- HomeKit treats it as a camera, not a doorbell.

## Apple Home — manual qualification

Pair each selected child in standalone Accessory Mode and preserve evidence that:

- local and remote live view work at expected resolution with expected audio;
- tiles refresh with current snapshots;
- the ordinary camera has no doorbell controls or notifications;
- twenty physical G4 presses produce exactly twenty Home doorbell events, including rapid double-press;
- Home microphone audio is physically audible at the G4 for ten start/talk/stop cycles;
- a press during talkback still produces one notification.

## HKSV — manual qualification

- Enable Stream & Recording and all-motion recording on the Doorbell.
- Trigger physical motion and confirm Scrypted motion state.
- Confirm the HomeKit plugin begins a camera recording session.
- Confirm a matching HKSV timeline clip appears and plays with expected audio.
- Repeat after MQTT reconnect, Frigate/go2rtc restart, plugin reload, Scrypted restart, and Home Hub handoff.

API, transport, codec, simulator, or Scrypted-boundary evidence cannot substitute for physical audibility or a user-visible HKSV timeline entry.
