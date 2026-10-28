import { describe, expect, it } from 'vitest';
import { createWorldState, DEFAULT_SEED } from '../src/world/state.js';
import { advanceMinutes, BOOT_MINUTES } from '../src/world/activity.js';

describe('watchdog', () => {
  it(
    'reaches a cross-surface campaign in under 2,000 ticks at 60x from a cold boot',
    { timeout: 120000 },
    () => {
      const state = createWorldState(DEFAULT_SEED);
      expect(state.tick).toBe(BOOT_MINUTES);
      let foundAt: number | null = null;
      for (let t = state.tick; t < 2000; t += 60) {
        advanceMinutes(state, 60);
        const hopping = state.campaigns.some((c) => {
          const surfaces = c.trail.map((entry) => entry.surface);
          return new Set(surfaces).size > 1;
        });
        if (hopping) {
          foundAt = state.tick;
          break;
        }
      }
      console.log(`first cross-surface campaign at tick ${foundAt} (seed ${DEFAULT_SEED})`);
      expect(foundAt, 'no cross-surface campaign within 2,000 ticks').not.toBeNull();
      expect(foundAt as number).toBeLessThan(2000);
    }
  );
});
