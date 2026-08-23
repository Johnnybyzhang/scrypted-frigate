import { describe, expect, it } from 'vitest';
import { DISCOVERY_FAILURES_BEFORE_OFFLINE, DiscoveryHealth } from '../src/discovery-health';

describe('DiscoveryHealth', () => {
  it('keeps the last inventory online through short Frigate outages', () => {
    const health = new DiscoveryHealth();
    health.succeeded();

    expect(health.failed(true)).toMatchObject({
      consecutiveFailures: 1,
      online: true,
      usingLastKnownInventory: true,
    });
    expect(health.failed(true)).toMatchObject({
      consecutiveFailures: DISCOVERY_FAILURES_BEFORE_OFFLINE - 1,
      online: true,
      usingLastKnownInventory: true,
    });
    expect(health.failed(true)).toMatchObject({
      consecutiveFailures: DISCOVERY_FAILURES_BEFORE_OFFLINE,
      online: false,
      usingLastKnownInventory: false,
    });
  });

  it('does not claim online without a known camera inventory', () => {
    const health = new DiscoveryHealth();
    expect(health.failed(false)).toMatchObject({ online: false, usingLastKnownInventory: false });
  });

  it('clears the failure count after a successful refresh', () => {
    const health = new DiscoveryHealth();
    health.failed(true);
    health.succeeded();
    expect(health.failed(true).consecutiveFailures).toBe(1);
  });
});
