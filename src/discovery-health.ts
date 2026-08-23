export const DISCOVERY_FAILURES_BEFORE_OFFLINE = 3;

export interface DiscoveryFailureState {
  consecutiveFailures: number;
  online: boolean;
  usingLastKnownInventory: boolean;
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
    };
  }

  reset(): void {
    this.consecutiveFailures = 0;
  }
}
