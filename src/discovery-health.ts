export const DISCOVERY_FAILURES_BEFORE_OFFLINE = 3;

export interface DiscoveryFailureState {
  consecutiveFailures: number;
  online: boolean;
  usingLastKnownInventory: boolean;
  /** True when no camera inventory has ever been discovered, so the device list must not be synced. */
  inventoryUnknown: boolean;
}

export class DiscoveryHealth {
  private consecutiveFailures = 0;

  succeeded(): void {
    this.consecutiveFailures = 0;
  }

  failed(hasLastKnownInventory: boolean): DiscoveryFailureState {
    this.consecutiveFailures += 1;
    const usingLastKnownInventory = hasLastKnownInventory
      && this.consecutiveFailures < DISCOVERY_FAILURES_BEFORE_OFFLINE;
    return {
      consecutiveFailures: this.consecutiveFailures,
      online: usingLastKnownInventory,
      usingLastKnownInventory,
      inventoryUnknown: !hasLastKnownInventory,
    };
  }

  reset(): void {
    this.consecutiveFailures = 0;
  }
}
