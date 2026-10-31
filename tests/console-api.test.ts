import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pipeline } from '../src/pipeline.js';
import type { PipelineMetrics } from '../src/pipeline.js';
import { USD_PER_MTOK_INPUT, USD_PER_MTOK_OUTPUT } from '../src/pipeline.js';
import type { Card, ProposeFn } from '../src/cards.js';
import type { Proposal } from '../src/models/muse.js';
import type { Cluster } from '../src/correlate.js';
import type { Observation } from '../src/contract.js';
import { createApp } from '../src/server.js';
import { renderAgo } from '../src/validate.js';
import { startFeed } from '../src/connectors/public.js';
import { CARD_TEMPLATES_V1 } from '../src/copy/card.v1.js';

// P10: the console API over one seeded fixture run. Five submissions against a
// feed listing plus world evidence produce every outcome the console must
// render: a confirmed card, a demoted card, a validator rejection, a model
// decline, and an ineligible silence. Copy comes from the template table, not
// from transcription — a drifted string would fail V4a loudly rather than
// pass quietly.

const NOW_MS = Date.parse('2026-06-10T12:00:00.000Z');
const FEED_PUBLISHED_AT = '2026-06-05T12:00:00.000Z';
const FEED_URL = 'https://feeds.example/scam-urls.txt';
const FEED_NAME = 'example-feed';

const realFetch = globalThis.fetch.bind(globalThis);

function templateCopy(id: string, fills: Record<string, string>): { headline: string; body: string } {
  const template = CARD_TEMPLATES_V1.find((entry) => entry.id === id);
  if (template === undefined) throw new Error(`no template ${id}`);
  const fill = (text: string): string => {
    let out = text;
    for (const [key, value] of Object.entries(fills)) out = out.split(`{${key}}`).join(value);
    return out;
  };
  return { headline: template.headline, body: template.body.map(fill).join(' ') };
}

function scriptedPropose(): ProposeFn {
  let calls = 0;
  return async (_cluster, indicators) => {
    const domain = indicators.find((stored) => stored.indicator.family === 'domain');
    const canonical = domain?.indicator.canonical ?? '';
    if (domain === undefined) throw new Error('no domain to cite');
    calls += 1;
    const usage = { inputTokens: 100 * calls, outputTokens: 10 * calls };
    const ms = 5 * calls;
    if (canonical === 'evil.example' || canonical === 'm.example') {
      const copy = templateCopy('F', { feedName: FEED_NAME, publishedAgo: renderAgo(NOW_MS, FEED_PUBLISHED_AT) });
      return {
        ok: true,
        data: {
          decision: 'emit',
          tier: 'confirmed',
          headline: copy.headline,
          body: copy.body,
          safeAction: 'leave_and_report',
          citations: [domain.id, domain.id],
          declineReason: null,
          confidence: 0.9
        },
        usage,
        ms
      };
    }
    if (canonical === 'a.example') {
      const copy = templateCopy('A', { family: 'domain', n: '99', surface: 'facebook' });
      return {
        ok: true,
        data: {
          decision: 'emit',
          tier: 'corroborated',
          headline: copy.headline,
          body: copy.body,
          safeAction: 'leave_and_report',
          citations: [domain.id, domain.id],
          declineReason: null,
          confidence: 0.7
        },
        usage,
        ms
      };
    }
    if (canonical === 'd.example') {
      return {
        ok: true,
        data: {
          decision: 'decline',
          tier: null,
          headline: null,
          body: null,
          safeAction: null,
          citations: [],
          declineReason: 'single_family',
          confidence: 0.3
        },
        usage,
        ms
      };
    }
    throw new Error(`unexpected cluster ${canonical}`);
  };
}

function worldObs(id: string, domain: string): Observation {
  return {
    id,
    source: 'world',
    observedAt: new Date(NOW_MS).toISOString(),
    surface: 'facebook',
    eventKind: 'link',
    actorRef: `world-actor-${id}`,
    subjectRef: null,
    threadRef: null,
    indicators: [{ kind: 'offplatform_link', value: `https://${domain}/x` }],
    claimCodes: [],
    consent: 'none',
    synthetic: true
  };
}

interface SubmissionPayload {
  card: Card | null;
  declineReason: string | null;
}

let base = '';
let runDir = '';
let closeServer: () => Promise<void> = async () => {};
let stopFeed = (): void => {};
const submissions: Record<string, SubmissionPayload> = {};

beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: unknown, init?: unknown) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1')) return realFetch(href, init as RequestInit);
    if (href === FEED_URL) {
      return new Response('https://evil.example/offer\nhttps://other.example/x\n', { status: 200 });
    }
    throw new Error(`unexpected outbound ${href}`);
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metshield-p10-'));
  runDir = path.join(root, 'run-p10');
  const pipeline = new Pipeline({ root, runId: 'run-p10', now: () => NOW_MS, propose: scriptedPropose() });
  const reader = startFeed({
    name: FEED_NAME,
    url: FEED_URL,
    format: 'lines',
    pollMs: 60000,
    assertedClaim: 'listing',
    publishedAt: FEED_PUBLISHED_AT,
    onObservation: (obs, meta) => {
      pipeline.ingest(obs, meta);
    },
    now: () => NOW_MS
  });
  stopFeed = (): void => reader.stop();
  await reader.poll();
  pipeline.ingest(worldObs('world:EV-a', 'a.example'));
  pipeline.ingest(worldObs('world:EV-m', 'm.example'));
  pipeline.ingest(worldObs('world:EV-d', 'd.example'));
  pipeline.ingest(worldObs('world:EV-s1', 'solo.example'));
  pipeline.ingest(worldObs('world:EV-s2', 'solo.example'));
  const server = createApp(pipeline).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const value of ['evil.example', 'a.example', 'm.example', 'd.example', 'fresh.example']) {
    const res = await realFetch(`${base}/v1/submissions/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, surface: 'messenger' })
    });
    if (res.status !== 200) throw new Error(`submit ${value} -> ${res.status}`);
    submissions[value] = (await res.json()) as SubmissionPayload;
  }
}, 30000);

afterAll(async () => {
  await closeServer();
  stopFeed();
  vi.unstubAllGlobals();
});

describe('console api', () => {
  it('submissions report their own quiet reasons', () => {
    expect(submissions['evil.example']?.card?.tier).toBe('confirmed');
    expect(submissions['a.example']?.card?.tier).toBe('context');
    expect(submissions['m.example']?.card).toBeNull();
    expect(submissions['m.example']?.declineReason).toBe('validator_rejected');
    expect(submissions['d.example']?.card).toBeNull();
    expect(submissions['d.example']?.declineReason).toBe('single_family');
    expect(submissions['fresh.example']?.card).toBeNull();
    expect(submissions['fresh.example']?.declineReason).toBe('ineligible_cluster');
  });

  it('metrics arithmetic matches the fixture run', async () => {
    const metrics = (await (await realFetch(`${base}/v1/metrics`)).json()) as PipelineMetrics;
    expect(metrics.observations).toEqual({
      total: 12,
      synthetic: 5,
      bySource: { world: 5, public_feed: 2, submission: 5 }
    });
    expect(metrics.clusters).toBe(7);
    expect(metrics.cards).toBe(2);
    expect(metrics.byTier).toEqual({ context: 1, corroborated: 0, confirmed: 1 });
    expect(metrics.eligibleEvents).toBe(5);
    expect(metrics.silentByReason).toEqual({ validator_rejected: 1, single_family: 1, ineligible_cluster: 1 });
    expect(metrics.demotions).toBe(1);
    expect(metrics.wouldHaveBeenTier).toEqual({ context: 0, corroborated: 1, confirmed: 1 });
    expect(metrics.modelCalls).toBe(4);
    expect(metrics.modelMs).toBe(50);
    const expected = (1000 / 1_000_000) * USD_PER_MTOK_INPUT + (100 / 1_000_000) * USD_PER_MTOK_OUTPUT;
    expect(metrics.costEstimateUsd).toBeCloseTo(expected, 10);
    expect(metrics.costEstimateUsd).toBeGreaterThan(0);
    console.log(`P10-METRICS ${JSON.stringify(metrics)}`);
  });

  it('clusters expose per-surface counts and syntheticAll', async () => {
    const body = (await (await realFetch(`${base}/v1/clusters`)).json()) as { clusters: Cluster[] };
    expect(body.clusters).toHaveLength(7);
    for (const cluster of body.clusters) {
      expect(typeof cluster.syntheticAll).toBe('boolean');
      expect(typeof cluster.perSurfaceCounts).toBe('object');
      const counted = Object.values(cluster.perSurfaceCounts).reduce((sum, count) => sum + (count ?? 0), 0);
      expect(counted).toBe(cluster.observationIds.length);
    }
    expect(body.clusters.filter((cluster) => cluster.surfaces.length === 2)).toHaveLength(4);
    const solo = body.clusters.find((cluster) => cluster.observationIds.includes('world:EV-s1'));
    expect(solo?.syntheticAll).toBe(true);
    const mixed = body.clusters.find((cluster) => cluster.observationIds.includes('world:EV-a'));
    expect(mixed?.syntheticAll).toBe(false);
  });

  it('pages cards newest-first with cursors', async () => {
    const evilId = submissions['evil.example']?.card?.id;
    const aId = submissions['a.example']?.card?.id;
    expect(typeof evilId).toBe('string');
    expect(typeof aId).toBe('string');
    const all = (await (await realFetch(`${base}/v1/cards`)).json()) as {
      cards: Card[];
      nextCursor: string | null;
    };
    expect(all.cards.map((card) => card.id)).toEqual([aId, evilId]);
    expect(all.nextCursor).toBeNull();
    const first = (await (await realFetch(`${base}/v1/cards?limit=1`)).json()) as {
      cards: Card[];
      nextCursor: string | null;
    };
    expect(first.cards.map((card) => card.id)).toEqual([aId]);
    expect(first.nextCursor).toBe(aId);
    const second = (await (await realFetch(`${base}/v1/cards?limit=1&cursor=${aId}`)).json()) as {
      cards: Card[];
      nextCursor: string | null;
    };
    expect(second.cards.map((card) => card.id)).toEqual([evilId]);
    expect(second.nextCursor).toBeNull();
    const unknown = await realFetch(`${base}/v1/cards?cursor=CARD-999999`);
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: string }).error).toBe('cursor_unknown');
    for (const bad of ['0', '-3', 'abc', '201']) {
      const res = await realFetch(`${base}/v1/cards?limit=${bad}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('limit_invalid');
    }
  });

  it('card detail carries citations, drops and the proposal', async () => {
    const evilId = submissions['evil.example']?.card?.id;
    const aId = submissions['a.example']?.card?.id;
    const evil = (await (await realFetch(`${base}/v1/cards/${evilId}`)).json()) as {
      card: Card;
      proposal: Proposal | null;
    };
    expect(evil.card.citations).toHaveLength(2);
    expect(evil.card.provenance.dropped).toEqual([]);
    expect(evil.proposal?.tier).toBe('confirmed');
    expect(evil.proposal?.headline).toBe(evil.card.headline);
    const a = (await (await realFetch(`${base}/v1/cards/${aId}`)).json()) as {
      card: Card;
      proposal: Proposal | null;
    };
    expect(a.card.tier).toBe('context');
    expect(a.card.template).toBe('A');
    expect(a.card.provenance.dropped).toEqual([{ rule: 'V8', text: '99', reason: 'slot n unresolved_numeral' }]);
    const aS2 = CARD_TEMPLATES_V1.find((entry) => entry.id === 'A')?.body[1];
    expect(a.card.body).toBe(aS2);
    expect(a.proposal?.tier).toBe('corroborated');
    const missing = await realFetch(`${base}/v1/cards/CARD-999999`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe('card_not_found');
  });

  it('ledgers one proposal per completed model call', () => {
    const lines = fs
      .readFileSync(path.join(runDir, 'proposals.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(4);
    const records = lines.map((line) => JSON.parse(line) as { cardId: string | null; proposal: Proposal });
    expect(records.filter((record) => record.cardId !== null)).toHaveLength(2);
    expect(records.filter((record) => record.cardId === null)).toHaveLength(2);
  });
});
