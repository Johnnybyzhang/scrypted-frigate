# Architecture

## Provider and child model

```text
Frigate /api/config -----------+---- camera inventory and roles
Frigate /api/go2rtc/streams ---+---- stream names and metadata
Frigate latest.jpg ---------------- snapshots
go2rtc RTSP ----------------------- live main/sub media
go2rtc API ------------------------ per-camera intercom destination
MQTT broker ----------------------- derived Frigate events + optional doorbell events
                                      |
                                      v
                         Frigate Camera Bridge provider
                           | one shared MQTT client
                           | one discovery inventory
                           +-- selected Camera child
                           +-- selected Doorbell child
                                      |
                                      v
                            Scrypted Core / HomeKit
```

The provider stores only shared endpoints, credentials, and the selected Frigate camera names. Native child ids are `frigate-camera:<encoded Frigate name>`, so deselecting and reselecting a camera preserves identity. `onDeviceDiscovered` registers a new native id before the child accesses Scrypted storage, then `onDevicesChanged` publishes the complete selected manifest.

There are no code branches for native, Docker, Apple Container, or other OCI packaging. Reachability is configuration, not platform detection.

## Discovery and media

`/api/config` supplies the camera list, enabled/audio flags, live stream mapping, FFmpeg role mapping, detect resolution, and MQTT prefix. `/api/go2rtc/streams` confirms available restreams and supplies codec/resolution metadata. Main and sub streams are selected by Frigate roles first and resolution second.

RTSP URLs default to `rtsp://<Frigate API host>:8554/<discovered stream>`. A single provider-level base override supports split-host or reverse-proxy deployments. There are no per-camera URL fields. `takePicture` uses `/api/<camera>/latest.jpg`.

## Interfaces and settings

Every child provides camera, snapshot, motion, online, and settings interfaces. Audio detection, doorbell/tamper sensors, and intercom are conditional. Switching a child between Camera and Doorbell republishes its descriptor and MQTT route; ordinary cameras never subscribe to external doorbell topics.

Global credentials stay on the provider. Doorbell mappings stay on the Doorbell. Frigate event topics are derived rather than stored.

## Events

One MQTT client subscribes to the union of selected-camera routes:

- `<topic_prefix>/available` once;
- `<topic_prefix>/<camera>/motion` for every camera;
- `<topic_prefix>/<camera>/audio/all` only when Frigate audio detection is enabled;
- external device availability, doorbell press, and tamper only for Doorbell children when configured.

Motion/audio accept retained level state. Doorbell/tamper reject retained packets and deduplicate event ids, timestamps, or MQTT delivery ids before raising pulses.

## Intercom

The bridge converts the Scrypted return-audio `MediaObject` to PCMA 8 kHz, exposes a single-use random HTTP stream through Scrypted, and asks go2rtc to attach it to the selected camera's API-discovered main stream. Only one intercom session is active at a time. Starting another session or stopping removes the ingress, clears the go2rtc source, and terminates FFmpeg.

go2rtc v1.9.14 requires the configured FFmpeg executable in `exec.allow_paths`. This remains server policy and is never altered by the plugin.

## Failure domains

- Frigate API failure marks discovered media offline but retains selected child identity and the last known inventory.
- RTSP failure affects live media only.
- MQTT failure affects motion/audio/binary state only.
- go2rtc API or Scrypted-ingress failure affects intercom only.
- Deselecting a child affects only Scrypted; it never mutates Frigate or go2rtc.
