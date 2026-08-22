export class EdgePulse {
  private readonly seen = new Map<string, number>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly pulseMs: number,
    private readonly setActive: (active: boolean) => void,
    private readonly now: () => number = Date.now,
  ) {}

  trigger(eventKey?: string): boolean {
    this.prune();
    if (eventKey && this.seen.has(eventKey))
      return false;
    if (eventKey)
      this.seen.set(eventKey, this.now());

    this.setActive(true);
    if (this.timer)
      clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.setActive(false);
    }, this.pulseMs);
    this.timer.unref?.();
    return true;
  }

  stop(): void {
    if (this.timer)
      clearTimeout(this.timer);
    this.timer = undefined;
    this.setActive(false);
    this.seen.clear();
  }

  private prune(): void {
    const cutoff = this.now() - Math.max(60_000, this.pulseMs * 4);
    for (const [key, timestamp] of this.seen) {
      if (timestamp < cutoff)
        this.seen.delete(key);
    }
    while (this.seen.size > 512) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (!oldest)
        break;
      this.seen.delete(oldest);
    }
  }
}
