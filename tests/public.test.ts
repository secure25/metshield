import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Observation } from '../src/contract.js';
import type { Card } from '../src/cards.js';
import type { ProposeFn } from '../src/cards.js';
import { Pipeline } from '../src/pipeline.js';
import type { PipelineMetrics } from '../src/pipeline.js';
import { extractJson, extractLines, startFeed } from '../src/connectors/public.js';
import { createApp } from '../src/server.js';
import { renderAgo } from '../src/validate.js';

const NOW = Date.parse('2026-06-10T12:00:00.000Z');
const T1 = '2026-06-01T12:00:00.000Z';
const FEED_URL = 'https://feeds.example/blocklist.txt';
const FEED_NAME = 'example-feed';
const FEED_PUBLISHED_AT = '2026-06-05T12:00:00.000Z';

function setup(propose: ProposeFn): { pipeline: Pipeline; app: Express } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metshield-p8-'));
  const pipeline = new Pipeline({ root, runId: 'run-1', now: () => NOW, propose });
  return { pipeline, app: createApp(pipeline) };
}

async function listen(app: Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no ephemeral port');
  const base = `http://127.0.0.1:${(address as AddressInfo).port}`;
  return {
    base,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

// Feed fixtures by URL; loopback passes through to the real fetch so the test
// client keeps working. Anything else throws, proving no third host is called.
function stubOutbound(feedBody: string): string[] {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: unknown, init?: unknown) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1')) return realFetch(href, init as RequestInit);
    calls.push(href);
    if (href === FEED_URL) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(feedBody) } as unknown as Response);
    }
    throw new Error(`unexpected outbound ${href}`);
  });
  return calls;
}

describe('feed connector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards custom json keys so per-entry dates land in attribution', async () => {
    const seen: Array<{ obs: Observation; publishedAt: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                urls: [
                  { url: 'https://evil.example/a', dateadded: '2026-06-08T10:00:00.000Z' },
                  { url: 'https://other.example/b', dateadded: '2026-06-09T10:00:00.000Z' }
                ]
              })
            )
        })
      )
    );
    const reader = startFeed({
      name: FEED_NAME,
      url: FEED_URL,
      format: 'json',
      pollMs: 60000,
      path: 'urls',
      publishedKey: 'dateadded',
      assertedClaim: 'listing',
      now: () => NOW,
      onObservation: (obs, meta) => {
        seen.push({ obs, publishedAt: meta.publishedAt });
      }
    });
    try {
      await reader.poll();
      expect(seen).toHaveLength(2);
      expect(seen[0]).toMatchObject({ publishedAt: '2026-06-08T10:00:00.000Z' });
      expect(seen[0].obs.id).toBe('feed:example-feed:evil.example');
      expect(seen[1]).toMatchObject({ publishedAt: '2026-06-09T10:00:00.000Z' });
    } finally {
      reader.stop();
    }
  });

  it('ingests a newline list with shape, codes and attribution', async () => {
    const seen: Array<{ obs: Observation; feedName: string; publishedAt: string; assertedClaim: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('https://evil.example/login\n\nnot a url at all!!!\nhttps://other.example/\n')
        })
      )
    );
    const reader = startFeed({
      name: FEED_NAME,
      url: FEED_URL,
      format: 'lines',
      pollMs: 60000,
      assertedClaim: 'listing',
      publishedAt: FEED_PUBLISHED_AT,
      now: () => NOW,
      onObservation: (obs, meta) => {
        seen.push({ obs, feedName: meta.feedName, publishedAt: meta.publishedAt, assertedClaim: meta.assertedClaim });
      }
    });
    try {
      await reader.poll();
      expect(seen).toHaveLength(2);
      expect(seen[0].obs).toMatchObject({
        id: 'feed:example-feed:evil.example',
        source: 'public_feed',
        surface: 'public_feed',
        consent: 'public_source',
        synthetic: false,
        claimCodes: ['public_blocklist']
      });
      expect(seen[0]).toMatchObject({ feedName: 'example-feed', publishedAt: FEED_PUBLISHED_AT, assertedClaim: 'listing' });
      const health = reader.getHealth();
      expect(health).toMatchObject({ name: 'example-feed', items: 2, errors: 1 });
      expect(health.lastPollAt).toBe(new Date(NOW).toISOString());
    } finally {
      reader.stop();
    }
  });

  it('ingests a JSON array at a configured path with per-entry dates', () => {
    const entries = extractJson(
      JSON.stringify({
        data: {
          urls: [
            { url: 'https://evil.example/a', publishedAt: '2026-05-01T00:00:00.000Z' },
            'https://bare.example/x'
          ]
        }
      }),
      { path: 'data.urls' }
    );
    expect(entries).toEqual([
      { url: 'https://evil.example/a', publishedAt: '2026-05-01T00:00:00.000Z' },
      { url: 'https://bare.example/x' }
    ]);
    expect(extractLines('https://a.example/\n')).toEqual([{ url: 'https://a.example/' }]);
  });

  it('stores a duplicate URL once across polls', async () => {
    let deliveries = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('https://evil.example/a\n') })
      )
    );
    const reader = startFeed({
      name: FEED_NAME,
      url: FEED_URL,
      format: 'lines',
      pollMs: 60000,
      assertedClaim: 'listing',
      onObservation: () => {
        deliveries += 1;
      }
    });
    try {
      await reader.poll();
      await reader.poll();
      expect(deliveries).toBe(1);
      expect(reader.getHealth()).toMatchObject({ items: 1, errors: 0 });
    } finally {
      reader.stop();
    }
  });

  it('makes no outbound request other than the feed URL', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: unknown) => {
      calls.push(String(url));
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('https://evil.example/a\n') });
    });
    const reader = startFeed({
      name: FEED_NAME,
      url: FEED_URL,
      format: 'lines',
      pollMs: 60000,
      assertedClaim: 'listing',
      onObservation: () => {}
    });
    try {
      await reader.poll();
      expect(calls).toEqual([FEED_URL]);
    } finally {
      reader.stop();
    }
  });

  it('stops delivering at maxItems and reports a head sample', async () => {
    let deliveries = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('https://a.example/\nhttps://b.example/\nhttps://c.example/\nhttps://d.example/\n')
        })
      )
    );
    const reader = startFeed({
      name: FEED_NAME,
      url: FEED_URL,
      format: 'lines',
      pollMs: 60000,
      assertedClaim: 'listing',
      maxItems: 2,
      onObservation: () => {
        deliveries += 1;
      }
    });
    try {
      await reader.poll();
      expect(deliveries).toBe(2);
      expect(reader.getHealth()).toMatchObject({ items: 2, errors: 0 });
    } finally {
      reader.stop();
    }
  });
});

function fBody(): string {
  return `This domain is listed in example-feed's reported-scam feed, published ${renderAgo(NOW, FEED_PUBLISHED_AT)}. That listing is the whole of our evidence — we have not seen it in a conversation or in an ad, and a listing is a claim about the domain, not proof about every use of it.`;
}

function worldObs(): Observation {
  return {
    id: 'world:EV-9',
    externalRef: 'EV-9',
    source: 'world',
    observedAt: T1,
    surface: 'facebook',
    eventKind: 'message',
    actorRef: 'FB-9',
    subjectRef: null,
    threadRef: null,
    indicators: [{ kind: 'offplatform_link', value: 'https://evil.example/offer' }],
    claimCodes: [],
    consent: 'none',
    synthetic: true
  };
}

describe('p8 acceptance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('item 1+4: a submitted feed domain returns the confirmed card by id', async () => {
    const proposeF: ProposeFn = async (_cluster, indicators) => {
      const evil = indicators.find((s) => s.indicator.canonical === 'evil.example');
      if (evil === undefined) throw new Error('evil indicator missing from proposal input');
      return {
        ok: true,
        data: {
          decision: 'emit',
          tier: 'confirmed',
          headline: 'This link is on a public blocklist.',
          body: fBody(),
          safeAction: 'leave_and_report',
          citations: [evil.id, evil.id],
          declineReason: null,
          confidence: 0.9
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        ms: 0
      };
    };
    const { pipeline, app } = setup(proposeF);
    const outbound = stubOutbound('https://evil.example/login\nhttps://other.example/page\n');
    const reader = startFeed({
      name: FEED_NAME,
      url: FEED_URL,
      format: 'lines',
      pollMs: 60000,
      assertedClaim: 'listing',
      publishedAt: FEED_PUBLISHED_AT,
      now: () => NOW,
      onObservation: (obs, meta) => {
        pipeline.ingest(obs, meta);
      }
    });
    const live = await listen(app);
    try {
      await reader.poll();
      const res = await fetch(`${live.base}/v1/submissions/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'https://evil.example/login', surface: 'messenger' })
      });
      expect(res.status).toBe(200);
      const submission = (await res.json()) as { card: Card | null; declineReason: string | null };
      const card = submission.card;
      expect(card).not.toBeNull();
      if (card === null) throw new Error('expected card');
      // Asserted by id on the returned card — never on an aggregate counter.
      const cardsRes = await fetch(`${live.base}/v1/cards`);
      const listed = ((await cardsRes.json()) as { cards: Card[] }).cards;
      expect(listed.map((c) => c.id)).toEqual([card.id]);
      expect(card.provenance.sources).toEqual(['public_feed', 'submission']);
      expect(card.provenance.synthetic).toBe(false);
      expect(card.provenance.evidenceBasis).toBe('source_reported');
      expect(card.tier).toBe('confirmed');
      expect(card.template).toBe('F');
      expect(card.provenance.attribution?.feedName).toBe('example-feed');
      expect(card.provenance.attribution?.publishedAt).toBe(FEED_PUBLISHED_AT);
      expect(card.provenance.attribution?.assertedClaim).toBe('listing');
      expect(card.citations).toHaveLength(2);
      const [first, second] = card.citations;
      expect(first.observationId).not.toBe(second.observationId);
      expect([first.surface, second.surface].sort()).toEqual(['public_feed', 'user_submission']);
      for (const citation of card.citations) {
        expect(pipeline.getObservation(citation.observationId)).toBeDefined();
      }
      // Same normalized key — and the key is the canonical domain, never the
      // raw submitted string a string compare would have matched instead.
      expect(first.indicatorId).toBe(second.indicatorId);
      const stored = pipeline.getIndicatorById(first.indicatorId);
      expect(stored?.indicator.canonical).toBe('evil.example');
      expect(stored?.indicator.canonical).not.toBe('https://evil.example/login');
      // Template F denies product observation; it never asserts A/B/C/D copy.
      for (const phrase of [
        'in this chat also',
        'ran as a paid ad',
        'used by more than one account',
        'asking for your code'
      ]) {
        expect(card.body).not.toContain(phrase);
      }
      const metricsRes = await fetch(`${live.base}/v1/metrics`);
      const metrics = (await metricsRes.json()) as PipelineMetrics;
      expect(metrics.observations.synthetic).toBe(0);
      expect(metrics.observations.total).toBe(3);
      expect(metrics.cards).toBe(1);
      expect(metrics.byTier).toEqual({ context: 0, corroborated: 0, confirmed: 1 });
      expect(outbound.every((url) => url === FEED_URL)).toBe(true);
      console.log(`P8-ACCEPTANCE ${JSON.stringify({ card, health: reader.getHealth(), metrics })}`);
    } finally {
      reader.stop();
      await live.close();
    }
  });

  it('item 2: a feed domain never submitted produces no card', async () => {
    const proposeThrow: ProposeFn = async () => {
      throw new Error('feed ingest must never propose');
    };
    const { pipeline, app } = setup(proposeThrow);
    stubOutbound('https://evil.example/login\n');
    const reader = startFeed({
      name: FEED_NAME,
      url: FEED_URL,
      format: 'lines',
      pollMs: 60000,
      assertedClaim: 'listing',
      publishedAt: FEED_PUBLISHED_AT,
      now: () => NOW,
      onObservation: (obs, meta) => {
        pipeline.ingest(obs, meta);
      }
    });
    const live = await listen(app);
    try {
      await reader.poll();
      const cardsRes = await fetch(`${live.base}/v1/cards`);
      expect(((await cardsRes.json()) as { cards: Card[] }).cards).toEqual([]);
      expect(pipeline.getMetrics().observations.total).toBe(1);
    } finally {
      reader.stop();
      await live.close();
    }
  });

  it('item 3: a submitted domain absent from every feed never confirms', async () => {
    const proposeThrow: ProposeFn = async () => {
      throw new Error('single-surface evidence must never propose');
    };
    const { pipeline, app } = setup(proposeThrow);
    stubOutbound('https://other.example/page\n');
    const reader = startFeed({
      name: FEED_NAME,
      url: FEED_URL,
      format: 'lines',
      pollMs: 60000,
      assertedClaim: 'listing',
      publishedAt: FEED_PUBLISHED_AT,
      now: () => NOW,
      onObservation: (obs, meta) => {
        pipeline.ingest(obs, meta);
      }
    });
    const live = await listen(app);
    try {
      await reader.poll();
      const res = await fetch(`${live.base}/v1/submissions/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'https://fresh.example/x', surface: 'messenger' })
      });
      expect(res.status).toBe(200);
      const submission = (await res.json()) as { card: Card | null; declineReason: string | null };
      // Submission-only evidence is single-surface by construction, so the
      // guard silences it: below context, and confirmed is unreachable.
      expect(submission.card).toBeNull();
      expect(submission.declineReason).toBe('ineligible_cluster');
      expect(pipeline.getMetrics().byTier.confirmed).toBe(0);
    } finally {
      reader.stop();
      await live.close();
    }
  });

  it('item 3a: feed plus world evidence produces template A, not F', async () => {
    const proposeA: ProposeFn = async (_cluster, indicators) => {
      const evil = indicators.find((s) => s.indicator.canonical === 'evil.example');
      if (evil === undefined) throw new Error('evil indicator missing from proposal input');
      return {
        ok: true,
        data: {
          decision: 'emit',
          tier: 'corroborated',
          headline: "This request is linked to an ad you didn't see.",
          body: "The domain in this chat also appeared in 1 facebook events we've linked to the same operation. The warning above already applies — this is why it may also be happening elsewhere.",
          safeAction: 'leave_and_report',
          citations: [evil.id, evil.id],
          declineReason: null,
          confidence: 0.8
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        ms: 0
      };
    };
    const { pipeline, app } = setup(proposeA);
    stubOutbound('https://evil.example/login\n');
    const reader = startFeed({
      name: FEED_NAME,
      url: FEED_URL,
      format: 'lines',
      pollMs: 60000,
      assertedClaim: 'listing',
      publishedAt: FEED_PUBLISHED_AT,
      now: () => NOW,
      onObservation: (obs, meta) => {
        pipeline.ingest(obs, meta);
      }
    });
    const live = await listen(app);
    try {
      expect(pipeline.ingest(worldObs()).accepted).toBe(true);
      await reader.poll();
      const res = await fetch(`${live.base}/v1/submissions/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'https://evil.example/login', surface: 'messenger' })
      });
      const submission = (await res.json()) as { card: Card | null; declineReason: string | null };
      const card = submission.card;
      expect(card).not.toBeNull();
      if (card === null) throw new Error('expected card');
      expect(card.template).toBe('A');
      expect(card.template).not.toBe('F');
      expect(card.provenance.evidenceBasis).toBe('observed');
    } finally {
      reader.stop();
      await live.close();
    }
  });

  it('mirror: blocklist copy on observed evidence goes silent', async () => {
    const proposeF: ProposeFn = async (_cluster, indicators) => {
      const evil = indicators.find((s) => s.indicator.canonical === 'evil.example');
      if (evil === undefined) throw new Error('evil indicator missing from proposal input');
      return {
        ok: true,
        data: {
          decision: 'emit',
          tier: 'confirmed',
          headline: 'This link is on a public blocklist.',
          body: fBody(),
          safeAction: 'leave_and_report',
          citations: [evil.id, evil.id],
          declineReason: null,
          confidence: 0.9
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        ms: 0
      };
    };
    const { pipeline, app } = setup(proposeF);
    stubOutbound('https://other.example/page\n');
    const live = await listen(app);
    try {
      expect(pipeline.ingest(worldObs()).accepted).toBe(true);
      const res = await fetch(`${live.base}/v1/submissions/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'https://evil.example/login', surface: 'messenger' })
      });
      const submission = (await res.json()) as { card: Card | null; declineReason: string | null };
      expect(submission.card).toBeNull();
      expect(submission.declineReason).toBe('validator_rejected');
    } finally {
      await live.close();
    }
  });

  it('routes: 400 on missing value and invalid surface', async () => {
    const proposeThrow: ProposeFn = async () => {
      throw new Error('invalid input must never propose');
    };
    const { app } = setup(proposeThrow);
    stubOutbound('');
    const live = await listen(app);
    try {
      const missing = await fetch(`${live.base}/v1/submissions/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface: 'messenger' })
      });
      expect(missing.status).toBe(400);
      const badSurface = await fetch(`${live.base}/v1/submissions/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'https://evil.example/x', surface: 'user_submission' })
      });
      expect(badSurface.status).toBe(400);
      const fresh = await fetch(`${live.base}/v1/cards`);
      expect(((await fresh.json()) as { cards: Card[] }).cards).toEqual([]);
      const metrics = (await (await fetch(`${live.base}/v1/metrics`)).json()) as PipelineMetrics;
      expect(metrics).toMatchObject({ clusters: 0, cards: 0 });
    } finally {
      await live.close();
    }
  });
});
