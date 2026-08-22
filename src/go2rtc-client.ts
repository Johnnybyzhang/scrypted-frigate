import type { Go2rtcConfig } from './types';
import { authorizationHeaders, fetchWithTimeout, HttpStatusError } from './http';

export class Go2rtcClient {
  constructor(private readonly config: Go2rtcConfig) {}

  async play(intercomSourceUrl: string, options: { finiteFile?: boolean } = {}): Promise<void> {
    const source = `ffmpeg:${intercomSourceUrl}#audio=pcma${options.finiteFile ? '#input=file' : ''}`;
    await this.post(source);
  }

  async stop(): Promise<void> {
    await this.post('');
  }

  private async post(source: string): Promise<void> {
    if (!this.config.apiUrl)
      throw new Error('go2rtc API URL is required for intercom');
    const url = new URL('/api/streams', this.config.apiUrl);
    url.searchParams.set('dst', this.config.streamName);
    url.searchParams.set('src', source);
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: authorizationHeaders({
        username: this.config.apiUsername,
        password: this.config.apiPassword,
      }),
    }, 10_000);
    if (!response.ok) {
      const detail = (await response.text())
        .slice(0, 512)
        .replace(/[a-f0-9]{48}/gi, '<intercom-token>')
        .trim();
      throw new HttpStatusError(
        `go2rtc intercom request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
      );
    }
    await response.body?.cancel().catch(() => undefined);
  }
}
