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

  it('flags an unknown inventory so a cold-start failure never syncs an empty device list', () => {
    const health = new DiscoveryHealth();
    expect(health.failed(false).inventoryUnknown).toBe(true);
    expect(health.failed(false).inventoryUnknown).toBe(true);
    expect(health.failed(false).inventoryUnknown).toBe(true);
  });

  it('does not flag an unknown inventory once cameras have been discovered', () => {
    const health = new DiscoveryHealth();
    health.succeeded();
    for (let i = 0; i < DISCOVERY_FAILURES_BEFORE_OFFLINE + 1; i += 1)
      expect(health.failed(true).inventoryUnknown).toBe(false);
  });

  it('clears the failure count after a successful refresh', () => {
    const health = new DiscoveryHealth();
    health.failed(true);
    health.succeeded();
    expect(health.failed(true).consecutiveFailures).toBe(1);
  });
});
