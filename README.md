# Frigate Camera Bridge for Scrypted

This Scrypted plugin reads the camera list from Frigate and creates the cameras you select in Scrypted Core. It uses Frigate snapshots, go2rtc streams, and MQTT events. The HomeKit plugin can then publish each camera as its own accessory.

## Install

Open Plugins in the Scrypted management console. Choose Install Plugin and enter:

```text
@johnnybyzhang/scrypted-frigate
```

Scrypted displays the provider as Frigate Camera Bridge.

## Camera discovery

The provider requests `/api/config` and `/api/go2rtc/streams` from Frigate. The Imported Cameras setting lists every camera in the Frigate configuration. Select a camera to add it to Scrypted. Remove the selection to remove the Scrypted device.

Each device keeps the native id `frigate-camera:<camera name>`. Removing and adding the same camera restores that id.

The Frigate configuration supplies stream names, FFmpeg roles, audio detection state, snapshot paths, and the MQTT prefix. The go2rtc response adds current codec and resolution data. RTSP URLs default to `rtsp://<Frigate host>:8554/<stream name>`. One provider setting can override the RTSP base URL when the API and restream service use different hosts.

A go2rtc stream may contain several producers. The bridge reads their receiver tracks separately for dimensions and audio metadata. Every RTSP input requests `?video=h264&audio`, so go2rtc starts a configured H.264 producer even when that producer is still lazy and missing from current receiver metadata. Backchannel sender tracks do not affect forward stream selection.

An empty or temporarily unreadable go2rtc inventory does not remove configured streams or mark cameras unavailable. The inventory adds metadata; Frigate's stream configuration remains authoritative. A failed Frigate configuration refresh keeps the last inventory online for two refresh cycles. The third consecutive failure marks the cameras offline.

## Stream lifetime

The bridge describes each go2rtc RTSP input as a local Scrypted stream. Scrypted Rebroadcast prebuffers local streams by default and owns the persistent upstream session. The bridge does not create a second hidden RTSP client.

`active rebroadcast clients: 0` counts viewers connected to Rebroadcast. It does not mean Rebroadcast closed its go2rtc connection. A new WebRTC viewer also creates a new downstream RTSP session, so its FFmpeg process may log one `461 Unsupported Transport` before retrying over TCP. To trace the upstream side, check go2rtc for a Scrypted consumer and an active H.264 producer after the viewer closes.

## Settings

Provider settings apply to every imported camera.

| Group | Settings |
| --- | --- |
| Frigate | API URL, API token, RTSP base override |
| Cameras | Refresh button, camera selector, discovery status |
| MQTT | Broker URL, username, password |
| Talkback | go2rtc API URL, username, password |

Camera settings stay on the camera.

| Camera type | Settings |
| --- | --- |
| Camera | Scrypted name, device type, intercom switch, discovered stream details |
| Doorbell | Camera settings plus availability, press, and tamper topics |

Frigate MQTT topics come from the Frigate prefix and camera name:

```text
<prefix>/available
<prefix>/<camera>/motion
<prefix>/<camera>/audio/all
```

The audio topic is active when Frigate enables audio detection for that camera. Doorbell press and tamper topics are configured on the Doorbell device.

## Scrypted interfaces

Every imported camera provides `VideoCamera`, `Camera`, `MotionSensor`, `Online`, and `Settings`.

Frigate audio detection adds `AudioSensor`. A Doorbell adds `BinarySensor` and `TamperSensor`. Enabling intercom adds `Intercom` when the provider can reach the go2rtc API.

## Talkback

The Scrypted HomeKit plugin terminates the HomeKit microphone session. It decrypts the incoming SRTP audio and calls this camera's `startIntercom` method with a local FFmpeg input. That input uses the codec negotiated by HomeKit, either AAC-ELD or Opus.

The bridge starts one streaming FFmpeg process. FFmpeg decodes the HomeKit-side input and encodes the camera-facing output as PCMA at 8 kHz. The bridge serves the PCMA/WAV stream at a single-use HTTP URL and passes that URL directly to go2rtc. go2rtc routes the encoded packets to the camera backchannel.

If go2rtc rejects PCMA, the bridge restarts its encoder with Opus at 48 kHz, two channels, 10 ms frames, and the low-delay application mode. It sends the Opus stream as MPEG-TS. go2rtc uses FFmpeg with `-c:a copy` to remux that stream into its internal RTSP path. The bridge remains the only process that changes the audio codec.

The bridge places these options before Scrypted's input arguments:

```text
-probesize 32 -analyzeduration 0 -fflags nobuffer -flags low_delay
```

This cuts startup probing for the local RTSP input that the HomeKit plugin has already described.

Stopping intercom removes the HTTP token, clears the go2rtc playback source, and terminates the bridge's FFmpeg process.

## Development

```sh
npm ci
npm run verify
```

The go2rtc checks build pinned tags from the upstream repository:

```sh
npm run test:e2e:go2rtc:matrix
```

The full local check runs two discovered cameras through Scrypted Core, Rebroadcast, MQTT, snapshots, HomeKit setup, and talkback. It also closes every test viewer and confirms that each camera stays online while Rebroadcast keeps its go2rtc consumer open:

```sh
npm ci --prefix e2e/scrypted-core
npm run test:e2e:scrypted-core
```

The first go2rtc run fetches the required tags into `.artifacts/`. Set `GO2RTC_SOURCE_DIR` to use an existing checkout.

See [E2E validation](docs/E2E.md) for the checks and saved evidence. See [HomeKit and HKSV acceptance](docs/HKSV_ACCEPTANCE.md) for pairing and recording checks.
