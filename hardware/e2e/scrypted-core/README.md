# Full Scrypted Core and HomeKit E2E

This harness runs a bare, isolated two-camera stack for validating the bridge inside the real Scrypted Core runtime:

- pinned Node 20 and Scrypted Core under ignored `.artifacts/`;
- native go2rtc v1.9.14 with paced FFmpeg main/sub streams for a Doorbell and an ordinary Camera;
- Frigate discovery/snapshot fixture and one shared MQTT broker;
- the bridge plugin, Rebroadcast, WebRTC, and HomeKit plugins.

The Doorbell main stream also has a PCMA 8 kHz backchannel sink. This lets the same full-runtime test call Scrypted's `Intercom` interface and preserve an audio artifact after routing through the plugin and go2rtc. The test also removes and re-adds the ordinary camera through the provider selector to prove stable discovery lifecycle.

Docker Desktop and container runtimes are not used. The runtime uses the host network so HomeKit mDNS and pairing exercise the same path as a normal native Scrypted installation.

Run `npm ci --prefix hardware/e2e/scrypted-core` once and `npm run test:e2e:scrypted-core` from the plugin root. Automated checks prove plugin loading, API discovery, conditional layouts/interfaces, Scrypted-visible streams, snapshots, events, Rebroadcast, intercom, and the HomeKit plugin boundary. Final HKSV acceptance additionally requires an Apple Home, Home Hub, iCloud HKSV entitlement, user-approved pairing, and a visible recording in the Home timeline.
