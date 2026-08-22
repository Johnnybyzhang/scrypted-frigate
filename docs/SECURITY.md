# Security

- The plugin never reads, stores, transmits, or logs the G4 rotating key.
- Frigate and MQTT credentials use Scrypted password settings.
- go2rtc credentials are sent with HTTP Basic authorization when configured.
- URLs and FFmpeg arguments are never logged because they may contain credentials or ephemeral HomeKit session tokens.
- Intercom ingress uses 192-bit random single-use tokens, is served with no-store/nosniff headers, and rejects a second consumer.
- MQTT payloads larger than 64 KiB are ignored.
- Retained doorbell/tamper MQTT packets are ignored.
- Frigate topics are API-derived. Only Doorbell children accept three explicit external mappings: availability, press, and tamper.
- No MQTT wildcard expansion, JSON expression evaluation, shell template, Docker socket, or host service control exists.
- Hardware scripts constrain the local key destination to ignored `private/`, reject symlinks, enforce owner-only permissions, and print only fingerprints.
- `.npmignore` excludes hardware tooling, tests, fixtures, private state, environment files, logs, and artifacts from the plugin package.

The local insecure HTTP endpoint is intentionally limited to the LAN because go2rtc/FFmpeg must consume a live stream without trusting Scrypted's self-signed certificate. The high-entropy path token is the stream capability. Operators should keep Scrypted and go2rtc on a trusted network.
