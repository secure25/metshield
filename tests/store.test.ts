import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import type { Observation } from '../src/contract.js';

const T0 = Date.parse('2026-06-01T12:00:00.000Z');
const DAY = 86400000;

function baseObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 'obs-1',
    externalRef: 'EV-1',
    source: 'world',
    observedAt: '2026-06-01T12:00:00.000Z',
    surface: 'facebook',
    eventKind: 'message',
    actorRef: 'FB-1',
    subjectRef: 'FB-2',
    threadRef: null,
    indicators: [{ kind: 'payment_handle', value: 'Pay.Me' }],
    claimCodes: ['offer'],
    consent: 'none',
    synthetic: true,
    ...overrides
  };
}

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metshield-store-'));
  let now = T0;
  const store = new Store('run-1', { root, now: () => now });
  return { store, dir: path.join(root, 'run-1'), setNow: (ms: number): void => { now = ms; } };
}

function readLines(dir: string, file: string): unknown[] {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return [];
  return fs
    .readFileSync(full, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

describe('store', () => {
  it('records a valid observation and indexes its indicators', () => {
    const { store, dir } = makeStore();
    const result = store.record(baseObservation());
    expect(result).toEqual({ accepted: true, joinedClusters: [] });
    const stored = store.get('payment_handle', 'pay.me');
    expect(stored?.id).toBe('IND-000001');
    expect(stored?.observationIds).toEqual(['obs-1']);
    expect(readLines(dir, 'observations.jsonl')).toHaveLength(1);
    const indicatorLines = readLines(dir, 'indicators.jsonl') as Array<{ event: string }>;
    expect(indicatorLines).toHaveLength(1);
    expect(indicatorLines[0].event).toBe('create');
  });

  it.each([
    { name: 'unknown top-level field', value: () => ({ ...baseObservation(), truth: true }) },
    { name: 'missing id', value: () => { const { id: _drop, ...rest } = baseObservation(); void _drop; return rest; } },
    { name: 'non-array indicators', value: () => ({ ...baseObservation(), indicators: 'nope' }) },
    { name: 'malformed indicator entry', value: () => ({ ...baseObservation(), indicators: [{ kind: 'payment_handle' }] }) },
    { name: 'bad observedAt', value: () => ({ ...baseObservation(), observedAt: 'not-a-time' }) },
    { name: 'null input', value: () => null },
    { name: 'array input', value: () => [] },
    { name: 'string input', value: () => 'obs-1' }
  ])('rejects $name', ({ value }) => {
    const { store } = makeStore();
    expect(store.record(value())).toEqual({ accepted: false, joinedClusters: [] });
  });

  it('keeps narrative-only observations with no indicator entries', () => {
    const { store, dir } = makeStore();
    const obs = baseObservation({
      id: 'obs-urgent',
      indicators: [{ kind: 'urgency_phrase', value: 'Hurry!' }],
      claimCodes: []
    });
    expect(store.record(obs)).toEqual({ accepted: true, joinedClusters: [] });
    expect(readLines(dir, 'indicators.jsonl')).toHaveLength(0);
    const lines = readLines(dir, 'observations.jsonl') as Array<{ normalizedClaimCodes: string[] }>;
    expect(lines).toHaveLength(1);
    expect(lines[0].normalizedClaimCodes).toEqual(['urgency_phrase']);
  });

  it('matches re-recorded indicators without duplicating', () => {
    const { store, dir } = makeStore();
    const obs = baseObservation();
    store.record(obs);
    store.record(obs);
    expect(store.get('payment_handle', 'pay.me')?.observationIds).toEqual(['obs-1']);
    const lines = readLines(dir, 'indicators.jsonl') as Array<{ event: string; indicatorId: string }>;
    expect(lines.map((l) => l.event)).toEqual(['create', 'match']);
    expect(lines[0].indicatorId).toBe(lines[1].indicatorId);
  });

  it('expires indicators by TTL with an injected clock', () => {
    const { store, dir, setNow } = makeStore();
    store.record(
      baseObservation({
        id: 'obs-ttl',
        indicators: [
          { kind: 'offplatform_link', value: 'https://bills.example/pay' },
          { kind: 'payment_handle', value: 'Shop.Keeper' }
        ]
      })
    );
    expect(store.get('domain', 'bills.example')).toBeDefined();
    setNow(T0 + 31 * DAY);
    const expired = store.sweepExpired();
    expect(expired).toHaveLength(1);
    expect(store.get('domain', 'bills.example')).toBeUndefined();
    expect(store.get('payment_handle', 'shop.keeper')).toBeDefined();
    const lines = readLines(dir, 'indicators.jsonl') as Array<{ event: string }>;
    expect(lines.filter((l) => l.event === 'expire')).toHaveLength(1);
  });
});
