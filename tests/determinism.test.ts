import { describe, expect, it } from 'vitest';
import { createWorldState } from '../src/world/state.js';
import { advanceMinutes, BOOT_MINUTES } from '../src/world/activity.js';

describe('world determinism', () => {
  it('same seed produces the same first state', () => {
    const a = createWorldState(42);
    const b = createWorldState(42);
    expect(a).toEqual(b);
  });

  it('same seed stays identical after 600 ticks', () => {
    const a = createWorldState(11);
    const b = createWorldState(11);
    advanceMinutes(a, 600 - BOOT_MINUTES);
    advanceMinutes(b, 600 - BOOT_MINUTES);
    expect(a.tick).toBe(600);
    expect(a).toEqual(b);
  });

  it('different seeds produce different populations', () => {
    const a = createWorldState(1);
    const b = createWorldState(2);
    expect(a.accounts).not.toEqual(b.accounts);
    expect(a.accounts[1].handle).not.toBe(b.accounts[1].handle);
  });

  it('snapshot is stable across pause and resume', () => {
    const a = createWorldState(7);
    advanceMinutes(a, 600 - BOOT_MINUTES);
    const b = createWorldState(7);
    advanceMinutes(b, 300 - BOOT_MINUTES);
    const snap = structuredClone(b);
    advanceMinutes(b, 300);
    expect(b.tick).toBe(600);
    expect(b).toEqual(a);
    expect(snap.tick).toBe(300);
  });
});
