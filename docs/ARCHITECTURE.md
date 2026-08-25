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

Frigate's live stream map and local go2rtc FFmpeg inputs define which restreams exist. `/api/go2rtc/streams` supplies current codec and resolution data when it is available. The plugin chooses the main and sub streams by Frigate role. Resolution breaks ties.

Each go2rtc stream can have several producers. Discovery reads only receiver tracks for forward dimensions and audio metadata. Every camera RTSP URL carries `video=h264&audio`. This filter starts a lazy H.264 transcoder instead of accepting the first active HEVC producer. Sender tracks belong to camera backchannels and do not become Scrypted forward-audio metadata.

The RTSP base defaults to port 8554 on the Frigate API host. The provider has one override for installations that place the API and RTSP server on different hosts.

Snapshots use `/api/<camera>/latest.jpg`.

## Stream lifetime and availability

The bridge returns a lazy FFmpeg input for each go2rtc RTSP URL and marks it as a local source. The Scrypted Rebroadcast mixin prebuffers local sources and keeps the upstream RTSP session open when its downstream viewer count reaches zero. A new Home or WebRTC viewer always creates a new downstream session to Rebroadcast. That viewer lifecycle does not control the bridge device's `Online` property.

Configured Frigate stream names remain available when go2rtc reports no active metadata. A go2rtc inventory error becomes a discovery warning. If the Frigate configuration endpoint fails, the provider keeps its last inventory online for two 30 second refresh cycles. It marks cameras offline on the third consecutive failure and restores them on the next successful refresh.

## MQTT

One MQTT client subscribes to the union of routes for all selected cameras.

```text
<prefix>/available
<prefix>/<camera>/motion
<prefix>/<camera>/audio/all
```

The audio route exists when Frigate enables audio detection for that camera. Doorbell devices can add availability, press, and tamper topics.

Motion and audio are level states, so retained messages are accepted. Frigate motion uses only `ON` and `OFF`; the camera starts off and MQTT disconnect clears it. Press and tamper are edge events. Common active values trigger directly. Optional per-device regexes match raw or compact JSON payloads. Inactive values, including `0`, do not trigger an edge. The router rejects retained edge messages and deduplicates MQTT redelivery by event id, timestamp, or message id.

## Talkback

The HomeKit plugin terminates the controller's microphone session and decrypts its SRTP packets. It republishes the decrypted AAC-ELD or Opus audio through a local RTSP input, wraps that input in a Scrypted `MediaObject`, and calls the camera's `startIntercom` method.

The bridge gets the FFmpeg input and executable from Scrypted. Its FFmpeg process keeps Scrypted's decoder arguments, then encodes the camera-facing stream. The first target is PCMA at 8 kHz, mono, in a streaming WAV container. The fallback is Opus at 48 kHz, stereo, with 10 ms frames in MPEG-TS.

The bridge sets a 32-byte probe, zero analysis time, no input buffer, and low-delay codec flags before the local RTSP input. It serves the encoded output once at a random 192-bit HTTP path.

The bridge posts that HTTP URL to go2rtc's stream-to-camera API. go2rtc reads PCMA/WAV directly and routes packets that match the camera's backchannel. A PCMA rejection or missing ingress connection makes the bridge retry once with Opus. The Opus retry asks go2rtc FFmpeg to copy the already encoded Opus packets into its internal RTSP path. It does not encode audio.

Only one talkback session runs at a time. Starting another session stops the first. Stop clears the go2rtc source, removes the HTTP path, and terminates FFmpeg.

## Failure behavior

- A short Frigate refresh failure keeps the selected device ids, last camera inventory, and online state. Three consecutive failures mark the cameras offline.
- Missing go2rtc metadata does not stop a configured camera. RTSP startup still reports a bad stream path when the configuration is wrong.
- RTSP errors affect live video.
- MQTT errors affect sensor state.
- Frigate HTTP errors affect discovery and snapshots.
- go2rtc API or HTTP ingress errors affect talkback.
