import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory())
      files.push(...sourceFiles(path));
    else if (path.endsWith('.ts'))
      files.push(path);
  }
  return files;
}

describe('plugin portability boundary', () => {
  it('contains no runtime packaging or G4 key coupling', () => {
    const files = sourceFiles(join(process.cwd(), 'src'));
    const source = files.map(path => readFileSync(path, 'utf8')).join('\n');
    for (const forbidden of [
      /process\.platform/,
      /docker/i,
      /kubernetes/i,
      /containerd/i,
      /session-key/i,
      /G4_KEY/,
      /\/var\/lib\//,
      /\/opt\//,
      /\.env\.local/,
      /ssh\s/i,
    ]) {
      expect(source, `forbidden plugin coupling: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('excludes external hardware and private state from the npm package', () => {
    const npmIgnore = readFileSync(join(process.cwd(), '.npmignore'), 'utf8');
    expect(npmIgnore).toContain('hardware/');
    expect(npmIgnore).toContain('private/');
    expect(npmIgnore).toContain('.env*');
    expect(npmIgnore).toContain('test/');
  });
});
