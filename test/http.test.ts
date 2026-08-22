import { describe, expect, it, vi } from 'vitest';
import { authorizationHeaders, fetchWithTimeout, redactUrl } from '../src/http';

describe('HTTP helpers', () => {
  it('creates bearer and basic authorization without logging credentials', () => {
    expect(authorizationHeaders({ bearerToken: 'secret' })).toEqual({ Authorization: 'Bearer secret' });
    expect(authorizationHeaders({ username: 'user', password: 'pass' }).Authorization).toBe('Basic dXNlcjpwYXNz');
  });

  it('redacts credentials and sensitive query parameters', () => {
    const redacted = redactUrl('https://user:pass@example.test/api?token=secret&src=camera');
    expect(redacted).not.toContain('pass');
    expect(redacted).not.toContain('secret');
    expect(redacted).toContain('redacted');
    expect(redacted).toContain('src=camera');
  });

  it('aborts a request after the timeout', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as typeof fetch;
    try {
      await expect(fetchWithTimeout('https://example.invalid', {}, 5)).rejects.toThrow('timed out');
    }
    finally {
      globalThis.fetch = originalFetch;
    }
  });
});
