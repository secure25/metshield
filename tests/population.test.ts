import { describe, expect, it } from 'vitest';
import { createWorldState, getWorldSummary } from '../src/world/state.js';
import { createPersona } from '../src/world/population.js';

const SEEDS_20 = Array.from({ length: 20 }, (_, i) => i + 1);

describe('population W1', () => {
  it('generates 480 accounts with per-surface counts summing to 480', () => {
    const state = createWorldState(20261026);
    expect(state.accounts).toHaveLength(480);
    let facebook = 0;
    let whatsapp = 0;
    let messenger = 0;
    for (const a of state.accounts) {
      if (a.surface === 'facebook') facebook++;
      else if (a.surface === 'whatsapp') whatsapp++;
      else messenger++;
    }
    console.log('per-surface counts:', { facebook, whatsapp, messenger });
    expect(facebook + whatsapp + messenger).toBe(480);
    const ids = new Set(state.accounts.map((a) => a.id));
    expect(ids.size).toBe(480);
    for (const a of state.accounts) {
      expect(a.id).toMatch(/^(FB|WA|MS)-\d{4}$/);
      expect(a.joinedMonthsAgo).toBeGreaterThanOrEqual(6);
      expect(a.joinedMonthsAgo).toBeLessThanOrEqual(80);
    }
  });

  it('has no handle collisions and every bio non-empty', () => {
    const state = createWorldState(20261026);
    const handles = state.accounts.map((a) => a.handle);
    expect(new Set(handles).size).toBe(handles.length);
    for (const a of state.accounts) {
      expect(a.bio.length).toBeGreaterThan(0);
      expect(a.handle).toMatch(/^[a-z0-9._]+$/);
      const tokens = a.handle.split(/[._]/);
      expect(tokens.length).toBeGreaterThanOrEqual(2);
      expect(tokens.length).toBeLessThanOrEqual(4);
    }
  });

  it('archetype shares land within +-3pp of target over 20 seeds', () => {
    const targets = { social: 0.08, daily: 0.32, light: 0.36, lurker: 0.24 };
    const counts = { social: 0, daily: 0, light: 0, lurker: 0 };
    let total = 0;
    for (const seed of SEEDS_20) {
      const state = createWorldState(seed);
      for (const a of state.accounts) {
        counts[a.persona.archetype]++;
        total++;
      }
    }
    for (const k of Object.keys(targets) as (keyof typeof targets)[]) {
      const share = counts[k] / total;
      console.log(k, counts[k], total, share.toFixed(4));
      expect(Math.abs(share - targets[k])).toBeLessThanOrEqual(0.03);
    }
  });

  it('enforces one account per person per surface over 20 seeds', () => {
    for (const seed of SEEDS_20) {
      const state = createWorldState(seed);
      const byPerson = new Map<string, string[]>();
      for (const a of state.accounts) {
        const list = byPerson.get(a.personId) ?? [];
        list.push(a.surface);
        byPerson.set(a.personId, list);
      }
      for (const [personId, surfaces] of byPerson) {
        expect(new Set(surfaces).size, `seed ${seed} person ${personId}`).toBe(surfaces.length);
      }
    }
  });

  it('derives persona from seed and personId only', () => {
    const p1 = createPersona(123, 'P-0001');
    const p2 = createPersona(123, 'P-0001');
    expect(p1).toEqual(p2);
  });

  it('state totals match the list', () => {
    const state = createWorldState(7);
    const summary = getWorldSummary(state);
    expect(summary.accounts.total).toBe(state.accounts.length);
    const per = summary.accounts.perSurface;
    expect(per.facebook + per.whatsapp + per.messenger).toBe(state.accounts.length);
    const ops = state.accounts.filter((a) => a.role === 'operator').length;
    const shells = state.accounts.filter((a) => a.role === 'shell').length;
    expect(summary.accounts.operators).toBe(ops);
    expect(summary.accounts.shells).toBe(shells);
  });
});
