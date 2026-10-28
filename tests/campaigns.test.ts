import { describe, expect, it } from 'vitest';
import { createWorldState } from '../src/world/state.js';
import { advanceMinutes, BOOT_MINUTES } from '../src/world/activity.js';
import { TEMPLATE_KEYS } from '../src/world/campaigns.js';
import type { Campaign } from '../src/world/types.js';

const SCAM_CLAIMS = new Set(['investment', 'prize', 'support', 'account-alert', 'delivery']);

function reachedRequestWithHop(c: Campaign): boolean {
  const stages = c.trail.map((t) => t.stage);
  if (!stages.includes('request')) return false;
  const hopStages = c.trail.filter((t) => t.stage === 'lure' || t.stage === 'cashout');
  return hopStages.some((t) => t.surface !== c.path[0]);
}

describe('campaigns', () => {
  it(
    'reaches request with a hop on at least 70% of 50 runs',
    { timeout: 120000 },
    () => {
      let passing = 0;
      for (let seed = 1; seed <= 50; seed++) {
        const state = createWorldState(seed);
        advanceMinutes(state, 1200 - BOOT_MINUTES);
        if (state.campaigns.some(reachedRequestWithHop)) passing++;
      }
      console.log(`request-with-hop runs: ${passing}/50`);
      expect(passing).toBeGreaterThanOrEqual(35);
    }
  );

  it(
    'hops within the operation to a different person and never leaves the path',
    { timeout: 120000 },
    () => {
      for (let seed = 1; seed <= 10; seed++) {
        const state = createWorldState(seed);
        advanceMinutes(state, 1200 - BOOT_MINUTES);
        const byId = new Map(state.accounts.map((a) => [a.id, a]));
        const opOf = new Map<string, string>();
        for (const op of state.operations) {
          for (const id of op.memberIds) opOf.set(id, op.id);
        }
        for (const c of state.campaigns) {
          for (const t of c.trail) {
            expect(c.path, `${c.id} trail surface`).toContain(t.surface);
          }
          for (let i = 1; i < c.trail.length; i++) {
            const prev = c.trail[i - 1];
            const cur = c.trail[i];
            if (cur.surface === prev.surface) continue;
            expect(opOf.get(cur.actorId), `${c.id} hop op`).toBe(c.operationId);
            expect(cur.actorId, `${c.id} hop account`).not.toBe(prev.actorId);
            expect(byId.get(cur.actorId)?.personId, `${c.id} hop person`).not.toBe(byId.get(prev.actorId)?.personId);
          }
        }
      }
    }
  );

  it(
    'spawns all eight templates at least once in 200 seeds',
    { timeout: 120000 },
    () => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 200; seed++) {
        const state = createWorldState(seed);
        for (const c of state.campaigns) seen.add(c.templateKey);
      }
      console.log(`templates seen: ${[...seen].sort().join(', ')}`);
      for (const key of TEMPLATE_KEYS) {
        expect(seen, `template ${key}`).toContain(key);
      }
    }
  );

  it('runs benign mirror journeys with legit shapes and codes', () => {
    const state = createWorldState(21);
    advanceMinutes(state, 1440 - BOOT_MINUTES);
    const kinds = new Set(state.journeys.map((j) => j.kind));
    expect(kinds).toEqual(new Set(['order', 'invite', 'friendpay', 'support']));
    const byId = new Map(state.accounts.map((a) => [a.id, a]));
    for (const j of state.journeys) {
      for (const id of j.actorIds) {
        expect(byId.get(id)?.role).toBe('legit');
      }
    }
    const codes = new Set(state.events.flatMap((e) => e.claimCodes));
    expect(codes.has('split-bill')).toBe(true);
    expect(codes.has('support')).toBe(true);
  });

  it(
    'cashes out scams and flips takeovers to taken_over',
    { timeout: 120000 },
    () => {
      const worlds: Array<ReturnType<typeof createWorldState>> = [];
      for (let seed = 1; seed <= 100; seed++) {
        const state = createWorldState(seed);
        if (state.campaigns.some((c) => c.templateKey === 'account-recovery')) {
          worlds.push(state);
        }
      }
      expect(worlds.length).toBeGreaterThan(0);
      for (const w of worlds) {
        advanceMinutes(w, 1780 - BOOT_MINUTES);
      }
      const takeovers = worlds.flatMap((w) =>
        w.campaigns
          .filter((c) => c.templateKey === 'account-recovery' && c.outcome === 'cashed_out')
          .map((c) => ({ world: w, campaign: c }))
      );
      expect(takeovers.length, 'takeover cashouts').toBeGreaterThan(0);
      for (const { world, campaign } of takeovers) {
        const victim = world.accounts.find((a) => a.personId === campaign.targetPersonId && a.surface === 'whatsapp');
        expect(victim?.role).toBe('taken_over');
      }
      const scamCash = worlds.flatMap((w) =>
        w.events.filter((e) => e.type === 'payment_attempted' && e.claimCodes.some((c) => SCAM_CLAIMS.has(c)))
      );
      expect(scamCash.length, 'scam payment cashouts').toBeGreaterThan(0);
    }
  );

  it(
    'requires a preceding request before any scam payment',
    { timeout: 120000 },
    () => {
      let checked = 0;
      for (let seed = 1; seed <= 15; seed++) {
        const state = createWorldState(seed);
        advanceMinutes(state, 1780 - BOOT_MINUTES);
        for (const c of state.campaigns) {
          if (c.outcome !== 'cashed_out') continue;
          const at = new Map(c.trail.map((t) => [t.stage, t.atMinute] as const));
          if (c.trail.some((t) => t.stage === 'cashout')) {
            expect(at.get('request'), `${c.id} paid without a request stage`).toBeDefined();
            expect(at.get('request') as number).toBeLessThan(at.get('cashout') as number);
          }
        }
        const shown = state.events.filter((e) => e.type === 'payment_request_shown');
        const attempts = state.events.filter(
          (e) => e.type === 'payment_attempted' && e.claimCodes.some((code) => SCAM_CLAIMS.has(code))
        );
        for (const attempt of attempts) {
          checked++;
          const prior = shown.some(
            (s) => s.actorId === attempt.actorId && s.targetId === attempt.targetId && s.simMinute <= attempt.simMinute
          );
          expect(prior, `seed ${seed} ${attempt.id} has no preceding request`).toBe(true);
        }
      }
      expect(checked).toBeGreaterThan(0);
    }
  );
});
