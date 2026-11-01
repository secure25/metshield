import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  DEMO_SEED,
  REQUIRED_HEADINGS,
  WORLD_ADVANCE_MINUTES,
  WORLD_BATCH_LIMIT,
  assertPublicResult,
  collectWorldBatch,
  runPublicDemo,
  runWorldScenario
} from '../src/harness.js';

// P12: the harness replays byte-identically, every report carries the full
// heading set (pinned here as an independent oracle, not re-read from the
// constant under test), and demo:public proves the P8 property end to end.

const FEED_BODY = 'https://evil.example/offer\nhttps://other.example/x\n';

const EXPECTED_HEADINGS: string[] = [
  '## Scenario',
  '## Source mix',
  '## Observations',
  '## Clusters',
  '## Cards by tier',
  '## Declines by reason (submitted links that emitted no card)',
  '## Demotions by rule',
  '## Model latency',
  '## Cost estimate',
  '## Limitations',
  '## Assertions'
];

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metshield-p12-'));
}

describe('harness', () => {
  it('demo:public is deterministic given a seed', async () => {
    const a = await runPublicDemo({ seed: DEMO_SEED, rootDir: tmpRoot(), feedBody: FEED_BODY });
    const b = await runPublicDemo({ seed: DEMO_SEED, rootDir: tmpRoot(), feedBody: FEED_BODY });
    expect(a.runId).toBe(b.runId);
    expect(fs.readFileSync(a.reportPath, 'utf8')).toBe(fs.readFileSync(b.reportPath, 'utf8'));
  }, 60000);

  it('report.md contains every required heading', async () => {
    const result = await runPublicDemo({ seed: DEMO_SEED, rootDir: tmpRoot(), feedBody: FEED_BODY });
    const text = fs.readFileSync(result.reportPath, 'utf8');
    expect(REQUIRED_HEADINGS).toEqual(EXPECTED_HEADINGS);
    for (const heading of EXPECTED_HEADINGS) {
      expect(text).toContain(heading);
    }
    expect(text.startsWith('# MetShield run report')).toBe(true);
    expect(text).toContain(`demo-public-${DEMO_SEED}`);
    expect(text).toContain('Validator thresholds not tuned on real data');
    expect(text).toContain('- emitted-card drops by rule: none');
    expect(text).toContain('- declined-card drops by rule: none');
  }, 60000);

  it('demo:public asserts zero synthetic observations and the P8 property', async () => {
    const result = await runPublicDemo({ seed: DEMO_SEED, rootDir: tmpRoot(), feedBody: FEED_BODY });
    expect(result.metrics.observations.synthetic).toBe(0);
    expect(result.metrics.observations.total).toBe(5);
    expect(result.metrics.clusters).toBe(3);
    expect(result.cards).toHaveLength(2);
    expect(result.metrics.byTier).toEqual({ context: 0, corroborated: 0, confirmed: 2 });
    expect(result.metrics.silentByReason).toEqual({ ineligible_cluster: 1 });
    expect(result.metrics.eligibleEvents).toBe(3);
    expect(result.metrics.modelCalls).toBe(2);
    for (const card of result.cards) {
      expect(card.tier).toBe('confirmed');
      expect(card.template).toBe('F');
      expect(card.provenance.sources).toEqual(['public_feed', 'submission']);
      expect(card.provenance.evidenceBasis).toBe('source_reported');
      expect(card.provenance.attribution?.feedName).toBe('example-feed');
      expect(card.provenance.attribution?.publishedAt).toBe('2026-06-05T12:00:00.000Z');
      expect(card.provenance.attribution?.assertedClaim).toBe('listing');
      expect(new Set(card.citations.map((citation) => citation.surface))).toEqual(
        new Set(['public_feed', 'user_submission'])
      );
      expect(new Set(card.citations.map((citation) => citation.observationId)).size).toBe(2);
    }
    const tainted = {
      ...result.metrics,
      observations: { ...result.metrics.observations, synthetic: 1 }
    };
    expect(() => assertPublicResult(tainted, result.cards)).toThrow(/synthetic/);
  }, 60000);

  it('demo:world runs the live world mix', async () => {
    const { default: app } = await import('../src/server.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const address = server.address() as AddressInfo;
      const batch = await collectWorldBatch(
        `http://127.0.0.1:${address.port}`,
        DEMO_SEED,
        WORLD_ADVANCE_MINUTES,
        WORLD_BATCH_LIMIT
      );
      expect(batch.observations.length).toBeGreaterThan(0);
      const result = await runWorldScenario(batch, { seed: DEMO_SEED, rootDir: tmpRoot(), feedBody: FEED_BODY });
      expect(result.metrics.observations.synthetic).toBe(8000);
      expect(result.metrics.observations.bySource).toEqual({ world: 8000, public_feed: 2, submission: 4 });
      expect(result.metrics.observations.total).toBe(8006);
      expect(result.metrics.clusters).toBe(30);
      expect(result.cards).toHaveLength(3);
      expect(result.metrics.byTier).toEqual({ context: 0, corroborated: 3, confirmed: 0 });
      expect(result.metrics.eligibleEvents).toBe(4);
      expect(result.metrics.silentByReason).toEqual({ validator_rejected: 1 });
      expect(result.metrics.demotions).toBe(0);
      expect(result.metrics.wouldHaveBeenTier).toEqual({ context: 0, corroborated: 1, confirmed: 0 });
      expect(result.metrics.modelCalls).toBe(4);
      const text = fs.readFileSync(result.reportPath, 'utf8');
      for (const heading of EXPECTED_HEADINGS) {
        expect(text).toContain(heading);
      }
      expect(text).toContain('validator restraint shown: passed (1 validator_rejected)');
    expect(text).toContain('- emitted-card drops by rule: none');
    expect(text).toContain(
      '- declined-card drops by rule: V11: 1 (missing_or_invalid_attribution), V2: 1 (citation_not_cross_surface)'
    );
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }, 180000);

  it('a fixed world batch replays byte-identically', async () => {
    const { default: app } = await import('../src/server.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const address = server.address() as AddressInfo;
      const batch = await collectWorldBatch(
        `http://127.0.0.1:${address.port}`,
        DEMO_SEED,
        WORLD_ADVANCE_MINUTES,
        WORLD_BATCH_LIMIT
      );
      const a = await runWorldScenario(batch, { seed: DEMO_SEED, rootDir: tmpRoot(), feedBody: FEED_BODY });
      const b = await runWorldScenario(batch, { seed: DEMO_SEED, rootDir: tmpRoot(), feedBody: FEED_BODY });
      expect(fs.readFileSync(a.reportPath, 'utf8')).toBe(fs.readFileSync(b.reportPath, 'utf8'));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }, 180000);
});
