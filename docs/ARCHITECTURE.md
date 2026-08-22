# Architecture

## Provider and cameras

```text
Frigate /api/config
Frigate /api/go2rtc/streams
          |
          v
Frigate Camera Bridge
  | one camera inventory
  | one MQTT connection
  |
  +-- selected Camera
  +-- selected Doorbell
          |
          v
Scrypted Core and HomeKit
```

The provider stores the shared Frigate, MQTT, and go2rtc connections. It also stores the selected Frigate camera names.

Each selected camera has a native id in this form:

```text
frigate-camera:<encoded Frigate camera name>
```

The provider calls `onDeviceDiscovered` before a new camera reads Scrypted storage. It then sends the selected camera list through `onDevicesChanged`. Descriptor and MQTT fingerprints stop the 30 second discovery refresh from restarting mixins or reconnecting MQTT when nothing changed.

## Discovery

`/api/config` supplies camera names, enabled state, audio detection, live stream mappings, FFmpeg roles, detect resolution, and the MQTT prefix.

`/api/go2rtc/streams` confirms which restreams exist and supplies codec and resolution data. The plugin chooses the main and sub streams by Frigate role. Resolution breaks ties.

The RTSP base defaults to port 8554 on the Frigate API host. The provider has one override for installations that place the API and RTSP server on different hosts.

Snapshots use `/api/<camera>/latest.jpg`.

## MQTT

One MQTT client subscribes to the union of routes for all selected cameras.

```text
<prefix>/available
<prefix>/<camera>/motion
<prefix>/<camera>/audio/all
```

The audio route exists when Frigate enables audio detection for that camera. Doorbell devices can add availability, press, and tamper topics.

Motion and audio are level states, so retained messages are accepted. Press and tamper are edge events. The router rejects retained edge messages and deduplicates MQTT redelivery by event id, timestamp, or message id.

## Talkback

The HomeKit plugin terminates the controller's microphone session and decrypts its SRTP packets. It republishes the decrypted AAC-ELD or Opus audio through a local RTSP input, wraps that input in a Scrypted `MediaObject`, and calls the camera's `startIntercom` method.

The bridge gets the FFmpeg input and executable from Scrypted. Its FFmpeg process keeps Scrypted's decoder arguments, then encodes the camera-facing stream. The first target is PCMA at 8 kHz, mono, in a streaming WAV container. The fallback is Opus at 48 kHz, stereo, with 10 ms frames in MPEG-TS.

The bridge sets a 32-byte probe, zero analysis time, no input buffer, and low-delay codec flags before the local RTSP input. It serves the encoded output once at a random 192-bit HTTP path.

The bridge posts that HTTP URL to go2rtc's stream-to-camera API. go2rtc reads PCMA/WAV directly and routes packets that match the camera's backchannel. A PCMA rejection or missing ingress connection makes the bridge retry once with Opus. The Opus retry asks go2rtc FFmpeg to copy the already encoded Opus packets into its internal RTSP path. It does not encode audio.

Only one talkback session runs at a time. Starting another session stops the first. Stop clears the go2rtc source, removes the HTTP path, and terminates FFmpeg.

## Failure behavior

- A failed Frigate refresh keeps the selected device ids and last camera inventory.
- RTSP errors affect live video.
- MQTT errors affect sensor state.
- Frigate HTTP errors affect discovery and snapshots.
- go2rtc API or HTTP ingress errors affect talkback.
