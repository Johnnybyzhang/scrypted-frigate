# Security

Scrypted stores the Frigate token, MQTT password, and go2rtc password. Their settings use password fields in the management UI.

Talkback uses a random 192-bit URL token. The HTTP handler accepts one connection for that token, sets `no-store` and `nosniff` headers, and removes the token when playback stops. URLs and FFmpeg arguments stay out of plugin logs because HomeKit sessions can place short-lived credentials in them.

The MQTT router accepts payloads up to 64 KiB. It ignores retained press and tamper messages. Doorbell and tamper regexes come from the local Scrypted device settings and run only on their exact configured topics. Invalid regexes are ignored and logged. The router also rejects duplicate edge events when the payload or MQTT packet supplies a stable id.

Frigate motion and audio topics come from the API camera name and MQTT prefix. A Doorbell can add three exact topics for availability, press, and tamper. The router uses no wildcard subscriptions.

The talkback FFmpeg arguments are fixed in code. Camera names and setting values are not inserted into shell commands. The process starts through `child_process.spawn` with an argument array.

The npm package contains the compiled plugin, source map, Scrypted zip, readme, changelog, license, status file, and package metadata. `.npmignore` removes source files, tests, E2E tools, logs, credentials, and generated artifacts.

go2rtc reaches the single-use talkback URL over Scrypted's local HTTP endpoint. Keep Scrypted and go2rtc on a trusted network or place that traffic on a private service network.
