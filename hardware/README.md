# G4 hardware harness

These scripts are external qualification tools. They are excluded from the Scrypted plugin package and the plugin never reads their files or environment variables.

## Key synchronization comes first

Set the SSH target in the calling environment, then fetch the current server-side rotating key:

```sh
export G4_KEY_SSH_TARGET=root@your-key-host
export G4_KEY_REMOTE_PATH=/var/lib/aqara-g4-relayless/runtime/session-key-cache.hex
npm run g4:key:sync
```

Set `G4_KEY_SSH_TARGET` to the authorized host that owns the active G4 media session. The example remote path matches the companion relayless service; override it when another external source owns key rotation.

The synchronizer uses a single non-interactive SSH connection with strict host-key checking, refuses symlink or non-owner-only key files, validates exactly 32 hexadecimal characters, writes atomically under ignored `private/`, and prints only a SHA-256 fingerprint.

If the authorized remote key requires privilege escalation, set `G4_KEY_REMOTE_SUDO=1`; the script uses `sudo -n` and fails rather than prompting.

Never commit, paste, log, or add the rotating key to Scrypted settings. Run synchronization again after an outdoor-unit power cycle.

## Read-only preflight

Configure any desired endpoints from `.env.example`, export them, and run:

```sh
npm run g4:preflight
```

The npm command always synchronizes the rotating key first, then validates the local key and optionally checks Frigate, the named go2rtc stream, and the existing MQTT availability topic. It never starts, stops, recreates, or changes a G4 source.

Do not start a competing G4 media producer or talkback writer while the server owns the hardware session.
