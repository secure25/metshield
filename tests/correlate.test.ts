import { describe, expect, it } from 'vitest';
import { Correlator, clusterIsEligibleForCard } from '../src/correlate.js';
import type { IngestEvent } from '../src/correlate.js';

function evt(observationId: string, overrides: Partial<IngestEvent> = {}): IngestEvent {
  return {
    observationId,
    surface: 'facebook',
    observedAt: '2026-06-01T12:00:00.000Z',
    synthetic: true,
    claimCodes: [],
    indicators: [],
    ...overrides
  } as IngestEvent;
}

const X = { id: 'IND-000001', family: 'domain' as const };
const Y = { id: 'IND-000002', family: 'payment_handle' as const };

describe('correlate', () => {
  it('two surfaces one family is eligible', () => {
    const c = new Correlator();
    const a = c.ingest(evt('obs-a', { surface: 'facebook', indicators: [X] }));
    const b = c.ingest(evt('obs-b', { surface: 'messenger', indicators: [X] }));
    expect(a).toEqual(b);
    expect(c.clusters()).toHaveLength(1);
    const [cluster] = c.clusters();
    expect(clusterIsEligibleForCard(cluster)).toBe(true);
    expect(cluster.surfaces).toEqual(['facebook', 'messenger']);
    expect(cluster.syntheticAll).toBe(true);
    expect(cluster.tierInputs.hasConfirmedIndicator).toBe(false);
  });

  it('one surface many observations is ineligible', () => {
    const c = new Correlator();
    c.ingest(evt('obs-a', { indicators: [X] }));
    c.ingest(evt('obs-b', { indicators: [X] }));
    c.ingest(evt('obs-c', { indicators: [X] }));
    expect(c.clusters()).toHaveLength(1);
    expect(clusterIsEligibleForCard(c.clusters()[0])).toBe(false);
  });

  it('a bridging indicator merges two clusters with union familyCount', () => {
    const c = new Correlator();
    expect(c.ingest(evt('obs-a', { surface: 'facebook', indicators: [X] }))).toEqual(['CLU-000001']);
    expect(c.ingest(evt('obs-b', { surface: 'messenger', indicators: [Y] }))).toEqual(['CLU-000002']);
    expect(c.ingest(evt('obs-c', { surface: 'whatsapp', indicators: [X, Y] }))).toEqual(['CLU-000001']);
    const clusters = c.clusters();
    expect(clusters).toHaveLength(1);
    const [merged] = clusters;
    expect(merged.id).toBe('CLU-000001');
    expect(merged.familyCount).toBe(2);
    expect(merged.indicatorIds).toEqual(['IND-000001', 'IND-000002']);
    expect(merged.observationIds).toEqual(['obs-a', 'obs-b', 'obs-c']);
    expect(merged.perSurfaceCounts).toEqual({ facebook: 1, messenger: 1, whatsapp: 1 });
    expect(merged.tierInputs.families).toEqual(['domain', 'payment_handle']);
    expect(clusterIsEligibleForCard(merged)).toBe(true);
  });

  it('syntheticAll is false when one real observation joins', () => {
    const c = new Correlator();
    c.ingest(evt('obs-a', { surface: 'facebook', indicators: [X] }));
    c.ingest(evt('obs-b', { surface: 'messenger', synthetic: false, indicators: [X] }));
    expect(c.clusters()[0].syntheticAll).toBe(false);
  });

  it('re-ingest is idempotent', () => {
    const c = new Correlator();
    const first = c.ingest(evt('obs-a', { indicators: [X] }));
    const second = c.ingest(evt('obs-a', { indicators: [X] }));
    expect(second).toEqual(first);
    expect(c.clusters()[0].observationIds).toEqual(['obs-a']);
  });

  it('observations without indicators join nothing', () => {
    const c = new Correlator();
    expect(c.ingest(evt('obs-a', { indicators: [] }))).toEqual([]);
    expect(c.clusters()).toHaveLength(0);
  });

  it('a public_blocklist code sets hasConfirmedIndicator', () => {
    const c = new Correlator();
    c.ingest(evt('obs-a', { indicators: [X], claimCodes: ['public_blocklist'] }));
    expect(c.clusters()[0].tierInputs.hasConfirmedIndicator).toBe(true);
  });
});
