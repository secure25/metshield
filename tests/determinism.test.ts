import { describe, expect, it } from 'vitest';
import { createWorldState } from '../src/world/state.js';

describe('world determinism', () => {
  it('same seed produces the same first state', () => {
    const a = createWorldState(42);
    const b = createWorldState(42);
    expect(a).toEqual(b);
  });
});
