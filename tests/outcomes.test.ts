import { describe, expect, it } from 'vitest';
import { createWorldState } from '../src/world/state.js';
import { advanceMinutes, BOOT_MINUTES } from '../src/world/activity.js';
import { WARNING_REASON } from '../src/world/campaigns.js';

describe('outcomes', () => {
  it(
    'high-gullibility quartile complies more often than the low quartile over 50 seeds',
    { timeout: 180000 },
    () => {
      const rows: Array<{ gull: number; cashed: boolean }> = [];
      for (let seed = 1; seed <= 50; seed++) {
        const state = createWorldState(seed);
        advanceMinutes(state, 2000 - BOOT_MINUTES);
        for (const c of state.campaigns) {
          if (!c.trail.some((t) => t.stage === 'cashout')) continue;
          const victim = state.accounts.find((a) => a.personId === c.targetPersonId);
          if (!victim) continue;
          rows.push({ gull: victim.persona.gullibility, cashed: c.outcome === 'cashed_out' });
        }
      }
      expect(rows.length).toBeGreaterThan(20);
      const sorted = [...rows].sort((a, b) => a.gull - b.gull);
      const q = Math.floor(sorted.length / 4);
      const low = sorted.slice(0, q);
      const high = sorted.slice(sorted.length - q);
      const rate = (rs: typeof rows): number => rs.filter((r) => r.cashed).length / rs.length;
      console.log(`compliance low=${rate(low).toFixed(3)} high=${rate(high).toFixed(3)} n=${rows.length}`);
      expect(rate(high)).toBeGreaterThan(rate(low));
    }
  );

  it(
    'takeover preserves personId and recovery restores the role with account_recovered',
    { timeout: 180000 },
    () => {
      let found: { state: ReturnType<typeof createWorldState>; targetPersonId: string } | null = null;
      for (let seed = 1; seed <= 100 && !found; seed++) {
        const state = createWorldState(seed);
        if (!state.campaigns.some((c) => c.templateKey === 'account-recovery')) continue;
        advanceMinutes(state, 1780 - BOOT_MINUTES);
        const c = state.campaigns.find((x) => x.templateKey === 'account-recovery' && x.outcome === 'cashed_out');
        if (c) found = { state, targetPersonId: c.targetPersonId };
      }
      if (!found) throw new Error('no takeover cashout in 100 seeds');
      const victim = found.state.accounts.find((a) => a.personId === found.targetPersonId && a.surface === 'whatsapp');
      expect(victim?.role).toBe('taken_over');
      expect(victim?.personId).toBe(found.targetPersonId);
      for (const a of found.state.accounts.filter((x) => x.personId === victim?.personId && x.id !== victim?.id)) {
        expect(a.role).toBe('legit');
      }
      advanceMinutes(found.state, 5000);
      expect(victim?.role).toBe('legit');
      const rec = found.state.events.filter((e) => e.type === 'account_recovered' && e.actorId === victim?.id);
      expect(rec.length).toBe(1);
      const took = found.state.events.find((e) => e.type === 'account_taken_over' && e.actorId === victim?.id);
      expect(took).toBeDefined();
      expect(rec[0].seq).toBeGreaterThan(took?.seq ?? 0);
    }
  );

  it(
    'warning_shown carries exactly { reason } and nothing else carries a payload',
    { timeout: 120000 },
    () => {
      let warnings = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const state = createWorldState(seed);
        advanceMinutes(state, 1780 - BOOT_MINUTES);
        for (const e of state.events) {
          if (e.type === 'warning_shown') {
            warnings++;
            expect(e.payload, 'warning payload present').toBeDefined();
            expect(Object.keys(e.payload ?? {}).sort()).toEqual(['reason']);
            expect(e.payload?.reason).toBe(WARNING_REASON);
            expect(WARNING_REASON).toBe('this contact may be a scam');
          } else {
            expect(e.payload, `${e.type} has no payload`).toBeUndefined();
          }
        }
      }
      expect(warnings).toBeGreaterThan(0);
    }
  );

  it('writes outcome exactly once and never recomputes', () => {
    const state = createWorldState(5);
    advanceMinutes(state, 3000 - BOOT_MINUTES);
    const snap = state.campaigns.map((c) => ({
      id: c.id,
      outcome: c.outcome ?? null,
      trail: c.trail.length,
      verdict: c.verdict ?? null
    }));
    advanceMinutes(state, 2000);
    for (const c of state.campaigns) {
      const s = snap.find((x) => x.id === c.id);
      expect(c.outcome ?? null).toBe(s?.outcome ?? null);
      expect(c.trail.length).toBe(s?.trail);
      expect(c.verdict ?? null).toBe(s?.verdict ?? null);
    }
  });
});
