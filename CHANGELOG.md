# Changelog

## 0.0.5 - 2026-08-26

- Preserve Frigate motion as an `ON` and `OFF` level state on the API-derived camera topic.
- Initialize motion as off and clear stale motion when MQTT disconnects.
- Add per-doorbell regex matching for press and tamper JSON payloads while retaining simple active values.

## 0.0.4 - 2026-08-23

- Request H.264 from every go2rtc RTSP stream, even when the H.264 producer has not started yet.
- Keep forward audio in the filtered RTSP request without relying on active receiver metadata.
- Test the lazy-producer case through Scrypted Rebroadcast and FFprobe.
- Keep configured cameras online when go2rtc metadata is empty or temporarily unavailable.
- Hold the last camera inventory through two failed Frigate refreshes before reporting cameras offline.
- Verify that Rebroadcast keeps its go2rtc consumers and H.264 producers active after every downstream viewer closes.

## 0.0.3 - 2026-08-23

- Inspect each go2rtc producer separately during camera discovery.
- Prefer an available H.264 receiver and add an H.264 codec filter to its RTSP URL.
- Keep camera backchannel senders out of forward video and audio metadata.

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
