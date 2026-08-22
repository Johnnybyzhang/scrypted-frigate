# Frigate Camera Bridge for Scrypted

This Scrypted plugin reads the camera list from Frigate and creates the cameras you select in Scrypted Core. It uses Frigate snapshots, go2rtc streams, and MQTT events. The HomeKit plugin can then publish each camera as its own accessory.

## Install

Open Plugins in the Scrypted management console. Choose Install Plugin and enter:

```text
@johnnybyzhang/scrypted-frigate
```

Scrypted displays the provider as Frigate Camera Bridge.

## Camera discovery

The provider requests `/api/config` and `/api/go2rtc/streams` from Frigate. The Imported Cameras setting lists every camera returned by those endpoints. Select a camera to add it to Scrypted. Remove the selection to remove the Scrypted device.

Each device keeps the native id `frigate-camera:<camera name>`. Removing and adding the same camera restores that id.

The API responses supply the stream names, FFmpeg roles, codec details, resolutions, audio detection state, snapshot path, and MQTT prefix. RTSP URLs default to `rtsp://<Frigate host>:8554/<stream name>`. One provider setting can override the RTSP base URL when the API and restream service use different hosts.

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

The full local check runs two discovered cameras through Scrypted Core, Rebroadcast, MQTT, snapshots, HomeKit setup, and talkback:

```sh
npm ci --prefix e2e/scrypted-core
npm run test:e2e:scrypted-core
```

The first go2rtc run fetches the required tags into `.artifacts/`. Set `GO2RTC_SOURCE_DIR` to use an existing checkout.

See [E2E validation](docs/E2E.md) for the checks and saved evidence. See [HomeKit and HKSV acceptance](docs/HKSV_ACCEPTANCE.md) for pairing and recording checks.
