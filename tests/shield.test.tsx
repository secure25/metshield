// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ShieldPage from '../src/console/shield/ShieldPage';
import type { Card, Cluster, PipelineMetrics } from '../src/console/shield/api';
import type { Proposal } from '../src/console/shield/api';

// P11: the console renders from the API, never from fixtures. fetch is stubbed
// per test; polling is off (pollMs 0) and the clock is frozen, so every age
// string is deterministic.

const NOW_MS = Date.parse('2026-06-10T12:00:00.000Z');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface ApiFixture {
  clusters: Cluster[];
  cards: Card[];
  detail: Record<string, { card: Card; proposal: Proposal | null } | { error: string; status: number }>;
  metrics: PipelineMetrics;
}

function stubApi(fixture: ApiFixture): void {
  vi.stubGlobal('fetch', async (url: unknown) => {
    const href = String(url);
    if (href === '/v1/clusters') return json({ clusters: fixture.clusters });
    if (href === '/v1/metrics') return json(fixture.metrics);
    if (href === '/v1/cards' || href.startsWith('/v1/cards?')) {
      return json({ cards: fixture.cards, nextCursor: null });
    }
    if (href.startsWith('/v1/cards/')) {
      const id = decodeURIComponent(href.slice('/v1/cards/'.length));
      const found = fixture.detail[id];
      if (found === undefined || 'error' in found) {
        const code = found !== undefined && 'error' in found ? found.error : 'card_not_found';
        const status = found !== undefined && 'error' in found ? found.status : 404;
        return json({ error: code }, status);
      }
      return json(found);
    }
    throw new Error(`unexpected request ${href}`);
  });
}

function makeCard(overrides: Partial<Card> & { id: string }): Card {
  return {
    clusterId: 'CLU-000001',
    tier: 'confirmed',
    template: 'F',
    surface: 'messenger',
    headline: 'This link is on a public blocklist.',
    body: 'Evidence body.',
    safeAction: 'leave_and_report',
    citations: [
      {
        indicatorId: 'IND-000001',
        family: 'domain',
        display: 'evil.example',
        surface: 'public_feed',
        observedAt: new Date(NOW_MS - 2 * 3600000).toISOString(),
        observationId: 'feed:example-feed:evil.example'
      }
    ],
    provenance: {
      sources: ['public_feed', 'submission'],
      synthetic: false,
      evidenceBasis: 'source_reported',
      attribution: { feedName: 'example-feed', publishedAt: '2026-06-05T12:00:00.000Z', assertedClaim: 'listing' },
      proposedTier: 'confirmed',
      dropped: [],
      model: 'muse-spark-1.3-contributor',
      promptVersion: 'card.v1'
    },
    createdAt: new Date(NOW_MS).toISOString(),
    expiresAt: new Date(NOW_MS + 72 * 3600000).toISOString(),
    ...overrides
  };
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    decision: 'emit',
    tier: 'confirmed',
    headline: 'This link is on a public blocklist.',
    body: 'Evidence body.',
    safeAction: 'leave_and_report',
    citations: ['IND-000001'],
    declineReason: null,
    confidence: 0.9,
    ...overrides
  };
}

function makeCluster(overrides: Partial<Cluster> & { id: string }): Cluster {
  return {
    indicatorIds: ['IND-000001'],
    surfaces: ['public_feed', 'user_submission'],
    observationIds: ['feed:example-feed:evil.example', 'sub-000001'],
    familyCount: 1,
    claimCodes: ['public_blocklist'],
    firstSeenAt: new Date(NOW_MS - 2 * 3600000).toISOString(),
    lastSeenAt: new Date(NOW_MS).toISOString(),
    perSurfaceCounts: { public_feed: 1, user_submission: 1 },
    syntheticAll: false,
    tierInputs: { crossSurfacePairs: [['public_feed', 'user_submission']], families: ['domain'], hasConfirmedIndicator: true },
    ...overrides
  };
}

function makeMetrics(overrides: Partial<PipelineMetrics> = {}): PipelineMetrics {
  return {
    observations: { total: 3, synthetic: 0, bySource: { world: 0, public_feed: 2, submission: 1 } },
    clusters: 1,
    cards: 1,
    byTier: { context: 0, corroborated: 0, confirmed: 1 },
    eligibleEvents: 5,
    silentByReason: { validator_rejected: 2, single_family: 1 },
    demotions: 0,
    wouldHaveBeenTier: { context: 0, corroborated: 0, confirmed: 0 },
    modelCalls: 2,
    modelMs: 40,
    costEstimateUsd: 0.0001,
    ...overrides
  };
}

describe('shield console', () => {
  it('renders exactly one citation chip carrying a surface and an age', async () => {
    const card = makeCard({ id: 'CARD-000001' });
    stubApi({
      clusters: [makeCluster({ id: 'CLU-000001' })],
      cards: [card],
      detail: { 'CARD-000001': { card, proposal: makeProposal() } },
      metrics: makeMetrics()
    });
    render(<ShieldPage pollMs={0} nowMs={NOW_MS} />);
    const chips = await screen.findAllByTestId('citation-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toContain('public_feed');
    expect(chips[0]?.textContent).toContain('2h ago');
  });

  it('shows a dropped claim in evidence and not in the surface payload', async () => {
    const card = makeCard({
      id: 'CARD-000001',
      provenance: {
        ...makeCard({ id: 'CARD-000001' }).provenance,
        dropped: [{ rule: 'V8', text: 'dropped-claim-marker', reason: 'slot n unresolved_numeral' }]
      }
    });
    stubApi({
      clusters: [makeCluster({ id: 'CLU-000001' })],
      cards: [card],
      detail: { 'CARD-000001': { card, proposal: makeProposal() } },
      metrics: makeMetrics()
    });
    render(<ShieldPage pollMs={0} nowMs={NOW_MS} />);
    await screen.findByText('V8');
    expect(screen.queryByText('dropped-claim-marker')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Surface preview' }));
    await screen.findByText('Preview of the payload a product renders under its own warning.');
    await screen.findByText(card.headline);
    expect(screen.queryByText('V8')).toBeNull();
    expect(screen.queryByText('dropped-claim-marker')).toBeNull();
  });

  it('shows the coded error for an unknown card id instead of an empty card', async () => {
    const card = makeCard({ id: 'CARD-000001' });
    stubApi({
      clusters: [],
      cards: [card],
      detail: { 'CARD-000001': { error: 'card_not_found', status: 404 } },
      metrics: makeMetrics({ cards: 0 })
    });
    render(<ShieldPage pollMs={0} nowMs={NOW_MS} />);
    await screen.findByText('card_not_found');
    expect(screen.queryByText(card.headline)).toBeNull();
    expect(screen.queryAllByTestId('citation-chip')).toHaveLength(0);
  });

  it('labels a single-surface cluster honestly instead of calling it mixed', async () => {
    stubApi({
      clusters: [
        makeCluster({
          id: 'CLU-000002',
          surfaces: ['user_submission'],
          perSurfaceCounts: { user_submission: 1 }
        })
      ],
      cards: [],
      detail: {},
      metrics: makeMetrics({ cards: 0, byTier: { context: 0, corroborated: 0, confirmed: 0 } })
    });
    render(<ShieldPage pollMs={0} nowMs={NOW_MS} />);
    await screen.findByText('CLU-000002');
    expect(screen.queryByText('mixed sources')).toBeNull();
    expect(screen.queryByText('single source')).not.toBeNull();
  });

  it('renders the restraint counts with a live region and the silent line', async () => {
    const card = makeCard({ id: 'CARD-000001' });
    stubApi({
      clusters: [],
      cards: [card],
      detail: { 'CARD-000001': { card, proposal: null } },
      metrics: makeMetrics()
    });
    render(<ShieldPage pollMs={0} nowMs={NOW_MS} />);
    const counts = await screen.findByTestId('restraint-counts');
    expect(counts.getAttribute('aria-live')).toBe('polite');
    expect(counts.textContent).toContain('5 eligible');
    expect((await screen.findByTestId('restraint-silent-line')).textContent).toBe(
      'No card emitted for 3 eligible events'
    );
  });

  it('renders the payload under an existing-warning shell', async () => {
    const card = makeCard({ id: 'CARD-000001' });
    stubApi({
      clusters: [],
      cards: [card],
      detail: { 'CARD-000001': { card, proposal: makeProposal() } },
      metrics: makeMetrics()
    });
    render(<ShieldPage pollMs={0} nowMs={NOW_MS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Surface preview' }));
    await screen.findByText('An existing warning is already here');
    expect(screen.queryByText(card.headline)).not.toBeNull();
    const feedName = card.provenance.attribution?.feedName ?? 'missing-feed';
    expect(screen.queryByText(new RegExp(`Listed by ${feedName}`))).not.toBeNull();
    const chips = screen.getAllByTestId('preview-chip');
    expect(chips.length).toBeGreaterThan(0);
  });
});
