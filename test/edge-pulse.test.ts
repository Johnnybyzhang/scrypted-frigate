import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgePulse } from '../src/edge-pulse';

describe('EdgePulse', () => {
  afterEach(() => vi.useRealTimers());

  it('pulses and resets the state', () => {
    vi.useFakeTimers();
    const states: boolean[] = [];
    const pulse = new EdgePulse(1500, active => states.push(active));

    expect(pulse.trigger('event:1')).toBe(true);
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(1499);
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(states).toEqual([true, false]);
  });

  it('deduplicates an event key but accepts a new event', () => {
    vi.useFakeTimers();
    const states: boolean[] = [];
    const pulse = new EdgePulse(1000, active => states.push(active));

    expect(pulse.trigger('event:1')).toBe(true);
    expect(pulse.trigger('event:1')).toBe(false);
    expect(pulse.trigger('event:2')).toBe(true);
    expect(states).toEqual([true, true]);
  });

  it('clears state and timers on stop', () => {
    vi.useFakeTimers();
    const states: boolean[] = [];
    const pulse = new EdgePulse(1000, active => states.push(active));
    pulse.trigger();
    pulse.stop();
    vi.runAllTimers();
    expect(states).toEqual([true, false]);
  });
});
