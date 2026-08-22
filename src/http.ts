import type { HttpCredentials } from './types';

export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

export function authorizationHeaders(credentials: HttpCredentials): Record<string, string> {
  if (credentials.bearerToken)
    return { Authorization: `Bearer ${credentials.bearerToken}` };
  if (credentials.username || credentials.password) {
    const encoded = Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`HTTP request timed out after ${timeoutMs} ms`)), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  }
  finally {
    clearTimeout(timer);
  }
}

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username)
      url.username = 'redacted';
    if (url.password)
      url.password = 'redacted';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|pass|secret|key|auth/i.test(key))
        url.searchParams.set(key, 'redacted');
    }
    return url.toString();
  }
  catch {
    return '<invalid-url>';
  }
}
