# Changelog

## 0.0.2 - 2026-08-23

- License the project under MIT.
- Decode HomeKit-side AAC-ELD or Opus and stream PCMA to the camera through go2rtc.
- Retry the camera-facing stream with low-delay Opus when PCMA is rejected.
- Cut FFmpeg probe size and analysis time for talkback startup.
- Remove camera-specific setup material and names.
- Rewrite the public docs around the plugin's actual controls and data flow.

## 0.0.1 - 2026-08-23

- Initial public release.
- Discover Frigate cameras and go2rtc streams through the Frigate API.
- Add or remove stable Scrypted camera children with a provider-level multi-select.
- Expose live main/sub video, snapshots, motion, conditional audio detection, and Online state.
- Support conditional Doorbell press/tamper sensors through MQTT.
- Route Scrypted/HomeKit intercom audio through go2rtc.
- Test mixed Camera and Doorbell devices through a native Scrypted Core setup.
