import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const projectDir = process.cwd();
const privateRoot = join(projectDir, 'private');
const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0))
    rmSync(path, { force: true, recursive: true });
  try {
    rmdirSync(privateRoot);
  }
  catch {
    // Preserve an existing/non-empty private directory.
  }
});

function fakeSsh(): string {
  const directory = mkdtempSync(join(tmpdir(), 'g4-key-sync-test.'));
  cleanupPaths.push(directory);
  const path = join(directory, 'ssh');
  writeFileSync(path, '#!/bin/sh\nprintf "%s\\n" "$FAKE_KEY"\n');
  chmodSync(path, 0o700);
  return directory;
}

function runSync(fakeKey: string, suffix: string) {
  const fakeBin = fakeSsh();
  const localRelative = `private/${suffix}/session-key.hex`;
  const localAbsolute = join(projectDir, localRelative);
  cleanupPaths.push(join(projectDir, 'private', suffix));
  const result = spawnSync('sh', ['hardware/sync-g4-key.sh'], {
    cwd: projectDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_KEY: fakeKey,
      G4_KEY_SSH_TARGET: 'authorized-test-server',
      G4_KEY_LOCAL_PATH: localRelative,
    },
  });
  return { result, localAbsolute };
}

describe('external G4 key synchronizer', () => {
  it('writes a validated owner-only key and prints only its fingerprint', () => {
    const key = '00'.repeat(16);
    const { result, localAbsolute } = runSync(key, `valid-${process.pid}`);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(localAbsolute, 'utf8')).toBe(key);
    expect(statSync(localAbsolute).mode & 0o777).toBe(0o600);
    expect(result.stdout).toContain('sha256=');
    expect(result.stdout).not.toContain(key);
  });

  it('fails closed on malformed key material', () => {
    const { result, localAbsolute } = runSync('not-a-media-key', `invalid-${process.pid}`);
    expect(result.status).not.toBe(0);
    expect(existsSync(localAbsolute)).toBe(false);
    expect(result.stderr).toContain('not 32 hexadecimal characters');
  });
});
