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

describe('plugin runtime isolation', () => {
  it('contains no host packaging assumptions', () => {
    const files = sourceFiles(join(process.cwd(), 'src'));
    const source = files.map(path => readFileSync(path, 'utf8')).join('\n');
    for (const forbidden of [
      /process\.platform/,
      /docker/i,
      /kubernetes/i,
      /containerd/i,
      /\/opt\//,
      /\.env\.local/,
    ]) {
      expect(source, `forbidden plugin coupling: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('keeps development files out of the npm package', () => {
    const npmIgnore = readFileSync(join(process.cwd(), '.npmignore'), 'utf8');
    expect(npmIgnore).toContain('e2e/');
    expect(npmIgnore).toContain('private/');
    expect(npmIgnore).toContain('.env*');
    expect(npmIgnore).toContain('test/');
  });
});
