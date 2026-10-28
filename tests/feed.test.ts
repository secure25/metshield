import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorldState, getWorldSummary } from '../src/world/state.js';
import { advanceMinutes, BOOT_MINUTES } from '../src/world/activity.js';
import { sliceObservations } from '../src/world/observations.js';
import { scanAndCount } from '../src/world/integrity.js';
import { CANARY_HANDLE, CANARY_SLUG } from '../src/world/population.js';
import { requireOperator, OPERATOR_KEY, OPERATOR_HEADER } from '../src/operatorAuth.js';
import type { Observation } from '../src/contract.js';
import type { WorldEvent } from '../src/world/types.js';

const FORBIDDEN_KEYS = ['truth', 'campaignId', 'label', 'score', 'raw'];
const INDICATOR_KINDS = new Set([
  'payment_handle',
  'offplatform_link',
  'urgency_phrase',
  'credential_request',
  'impersonated_brand',
  'unsolicited_contact',
  'prize_claim'
]);
const SURFACES = new Set(['facebook', 'messenger', 'whatsapp']);
const KINDS = new Set(['message', 'post', 'ad', 'group_invite', 'link']);

function stringsOf(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) stringsOf(v, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) stringsOf(v, out);
  }
}

function collectAll(events: WorldEvent[]): Observation[] {
  const out: Observation[] = [];
  let cursor = 0;
  for (;;) {
    const page = sliceObservations(events, cursor, 1000);
    out.push(...page.observations);
    if (page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

describe('feed', () => {
  it('projects clean observations: no truth keys, synthetic world records, closed unions', () => {
    const state = createWorldState(7);
    const observations = collectAll(state.events);
    expect(observations.length).toBe(state.events.length);
    for (const obs of observations) {
      for (const k of FORBIDDEN_KEYS) {
        expect(Object.keys(obs)).not.toContain(k);
      }
      expect(obs.synthetic).toBe(true);
      expect(obs.source).toBe('world');
      expect(obs.consent).toBe('none');
      expect(SURFACES.has(obs.surface)).toBe(true);
      expect(KINDS.has(obs.eventKind)).toBe(true);
      for (const ind of obs.indicators) {
        expect(INDICATOR_KINDS.has(ind.kind)).toBe(true);
      }
      expect(obs.id.startsWith('world:')).toBe(true);
      expect(typeof obs.observedAt).toBe('string');
    }
  });

  it('lets no surfaceText value reach the serialised feed', () => {
    const state = createWorldState(11);
    const observations = collectAll(state.events);
    const texts = new Set(state.events.map((e) => e.surfaceText));
    const values: string[] = [];
    for (const obs of observations) stringsOf(obs, values);
    for (const v of values) {
      expect(texts.has(v), `leaked value: ${v}`).toBe(false);
    }
    const serialised = JSON.stringify(observations);
    for (const t of texts) {
      if (t.length > 30) {
        expect(serialised.includes(t), `leaked text: ${t}`).toBe(false);
      }
    }
  });

  it(
    'never leaks the canary marker over 5,000 ticks with zero integrity violations',
    { timeout: 120000 },
    () => {
      const state = createWorldState(7);
      advanceMinutes(state, 5000);
      const observations = collectAll(state.events);
      for (const obs of observations) {
        const values: string[] = [];
        stringsOf(obs, values);
        for (const v of values) {
          expect(v.includes(CANARY_HANDLE), `canary handle leaked: ${v}`).toBe(false);
          expect(v.includes(CANARY_SLUG), `canary slug leaked: ${v}`).toBe(false);
        }
      }
      scanAndCount(state, observations);
      expect(state.integrity.observationsSent).toBeGreaterThan(0);
      expect(state.integrity.truthLabelsSentToDetector).toBe(0);
      expect(state.integrity.rawTextInObservations).toBe(0);
      expect(state.integrity.campaignMarkersInObservations).toBe(0);
      expect(state.integrity.canaryLeaks).toBe(0);
    }
  );

  it('keeps the observation module free of the truth store', () => {
    const obsPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/world/observations.ts');
    const src = fs.readFileSync(obsPath, 'utf8');
    expect(src).not.toMatch(/from\s+['"][^'"]*truth[^'"]*['"]/);
    expect(src.includes('truth')).toBe(false);
  });

  it('requires the operator header on gated routes and accepts it', () => {
    expect(OPERATOR_HEADER).toBe('x-operator-key');
    const run = (headers: Record<string, string>): { status: number; next: boolean } => {
      let status = 200;
      let next = false;
      const req = { headers } as unknown as Parameters<typeof requireOperator>[0];
      const res = {
        status: (code: number) => {
          status = code;
          return { json: () => undefined };
        }
      } as unknown as Parameters<typeof requireOperator>[1];
      requireOperator(req, res, () => {
        next = true;
      });
      return { status, next };
    };
    expect(run({})).toEqual({ status: 401, next: false });
    expect(run({ [OPERATOR_HEADER]: 'wrong' })).toEqual({ status: 401, next: false });
    expect(run({ [OPERATOR_HEADER]: OPERATOR_KEY })).toEqual({ status: 200, next: true });
  });

  it('pages by seq cursor without overlap and rebuilds identically after restart', () => {
    const a = createWorldState(9);
    const p1 = sliceObservations(a.events, 0, 100);
    expect(p1.observations).toHaveLength(100);
    expect(p1.nextCursor).toBe(100);
    const p2 = sliceObservations(a.events, p1.nextCursor, 100);
    expect(p2.observations).toHaveLength(100);
    expect(p2.nextCursor).toBe(200);
    expect(p2.observations[0].externalRef).not.toBe(p1.observations[99].externalRef);
    const b = createWorldState(9);
    expect(sliceObservations(b.events, 0, 100)).toEqual(p1);
  });

  it('reports state totals equal to the sum of per-surface counts', () => {
    const summary = getWorldSummary(createWorldState(3));
    const per = summary.accounts.perSurface;
    expect(summary.accounts.total).toBe(per.facebook + per.whatsapp + per.messenger);
  });

  it('serves observations through the metering gate', () => {
    const state = createWorldState(13);
    expect(state.integrity.observationsSent).toBe(0);
    const page = sliceObservations(state.events, 0, 50);
    scanAndCount(state, page.observations);
    expect(state.integrity.observationsSent).toBe(50);
    expect(state.integrity.truthLabelsSentToDetector).toBe(0);
  });
});
