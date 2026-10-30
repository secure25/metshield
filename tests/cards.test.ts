import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Observation, ObservationSource, ObservationSurface } from '../src/contract.js';
import type { Cluster } from '../src/correlate.js';
import { Store } from '../src/store.js';
import type { StoredIndicator, StoredObservation } from '../src/store.js';
import type { Proposal } from '../src/models/muse.js';
import { buildCard, resolveCitations } from '../src/cards.js';
import type { Card, FeedAttribution, ProposeFn } from '../src/cards.js';
import { CARD_PROMPT_VERSION, CARD_SYSTEM_PROMPT } from '../src/models/prompts/card.v1.js';

const NOW = Date.parse('2026-06-10T12:00:00.000Z');

function makeObs(
  id: string,
  surface: ObservationSurface,
  source: ObservationSource,
  observedAt: string,
  synthetic: boolean,
  consent: Observation['consent'] = 'none'
): StoredObservation {
  return {
    observation: {
      id,
      source,
      observedAt,
      surface,
      eventKind: 'message',
      actorRef: 'actor-1',
      subjectRef: null,
      threadRef: null,
      indicators: [],
      claimCodes: [],
      consent,
      synthetic
    },
    normalizedClaimCodes: [],
    acceptedAt: observedAt
  };
}

function makeDomain(id: string, canonical: string, observationIds: string[]): StoredIndicator {
  return {
    id,
    indicator: { family: 'domain', canonical, display: canonical, registrable: canonical },
    firstSeenAt: '2026-06-01T12:00:00.000Z',
    lastSeenAt: '2026-06-02T12:00:00.000Z',
    observationIds,
    expiresAt: '2026-07-02T12:00:00.000Z'
  };
}

function makeHandle(id: string, canonical: string, display: string, observationIds: string[]): StoredIndicator {
  return {
    id,
    indicator: { family: 'payment_handle', canonical, display, variant: display },
    firstSeenAt: '2026-06-01T12:00:00.000Z',
    lastSeenAt: '2026-06-02T12:00:00.000Z',
    observationIds,
    expiresAt: '2026-08-31T12:00:00.000Z'
  };
}

function makeCluster(overrides: Partial<Cluster> & { id: string }): Cluster {
  return {
    indicatorIds: [],
    surfaces: [],
    observationIds: [],
    familyCount: 0,
    claimCodes: [],
    firstSeenAt: '2026-06-01T12:00:00.000Z',
    lastSeenAt: '2026-06-02T12:00:00.000Z',
    perSurfaceCounts: {},
    syntheticAll: true,
    tierInputs: { crossSurfacePairs: [], families: [], hasConfirmedIndicator: false },
    ...overrides
  };
}

function emitProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    decision: 'emit',
    tier: 'context',
    headline: "This request is linked to an ad you didn't see.",
    body: "The domain in this chat also appeared in 2 facebook events we've linked to the same operation. The warning above already applies — this is why it may also be happening elsewhere.",
    safeAction: 'leave_and_report',
    citations: [],
    declineReason: null,
    confidence: 0.8,
    ...overrides
  };
}

function stubPropose(proposal: Proposal): ProposeFn {
  return async () => ({ ok: true, data: proposal, usage: { inputTokens: 0, outputTokens: 0 }, ms: 0 });
}

const stubTimeout: ProposeFn = async () => ({ ok: false, code: 'timeout', detail: 'slow' });

function makeRunDir(): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'metshield-cards-')), 'run-1');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readCards(dir: string): unknown[] {
  const full = path.join(dir, 'cards.jsonl');
  if (!fs.existsSync(full)) return [];
  return fs
    .readFileSync(full, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function lookups(indicators: StoredIndicator[], observations: StoredObservation[]) {
  return {
    indicatorsById: new Map(indicators.map((stored) => [stored.id, stored])),
    observationsById: new Map(observations.map((stored) => [stored.observation.id, stored]))
  };
}

describe('resolveCitations', () => {
  it('resolves to the earliest observation on another surface', () => {
    const fbEarly = makeObs('obs-fb-1', 'facebook', 'world', '2026-06-01T12:00:00.000Z', true);
    const fbLate = makeObs('obs-fb-2', 'facebook', 'world', '2026-06-02T12:00:00.000Z', true);
    const wa = makeObs('obs-wa-1', 'whatsapp', 'world', '2026-06-01T13:00:00.000Z', true);
    const domain = makeDomain('IND-000001', 'bills.example', ['obs-fb-1', 'obs-fb-2', 'obs-wa-1']);
    const cluster = makeCluster({
      id: 'CLU-000001',
      indicatorIds: ['IND-000001'],
      surfaces: ['facebook', 'whatsapp'],
      observationIds: ['obs-fb-1', 'obs-fb-2', 'obs-wa-1']
    });
    const { citations, rejected } = resolveCitations(
      cluster,
      ['IND-000001'],
      'whatsapp',
      NOW,
      lookups([domain], [fbEarly, fbLate, wa])
    );
    expect(rejected).toEqual([]);
    expect(citations).toEqual([
      {
        indicatorId: 'IND-000001',
        family: 'domain',
        display: 'bills.example',
        surface: 'facebook',
        observedAt: '2026-06-01T12:00:00.000Z',
        observationId: 'obs-fb-1'
      }
    ]);
  });

  it('tie-breaks same-time observations by ascending id', () => {
    const b = makeObs('obs-b', 'facebook', 'world', '2026-06-01T12:00:00.000Z', true);
    const a = makeObs('obs-a', 'facebook', 'world', '2026-06-01T12:00:00.000Z', true);
    const domain = makeDomain('IND-000001', 'bills.example', ['obs-b', 'obs-a']);
    const cluster = makeCluster({
      id: 'CLU-000001',
      indicatorIds: ['IND-000001'],
      observationIds: ['obs-a', 'obs-b']
    });
    const { citations } = resolveCitations(cluster, ['IND-000001'], 'whatsapp', NOW, lookups([domain], [b, a]));
    expect(citations).toHaveLength(1);
    expect(citations[0].observationId).toBe('obs-a');
  });

  it('resolves nothing when the indicator only appears on the card surface', () => {
    const m1 = makeObs('obs-m-1', 'messenger', 'world', '2026-06-01T12:00:00.000Z', true);
    const m2 = makeObs('obs-m-2', 'messenger', 'world', '2026-06-02T12:00:00.000Z', true);
    const domain = makeDomain('IND-000001', 'bills.example', ['obs-m-1', 'obs-m-2']);
    const cluster = makeCluster({
      id: 'CLU-000001',
      indicatorIds: ['IND-000001'],
      surfaces: ['facebook', 'messenger'],
      observationIds: ['obs-m-1', 'obs-m-2']
    });
    const { citations, rejected } = resolveCitations(
      cluster,
      ['IND-000001'],
      'messenger',
      NOW,
      lookups([domain], [m1, m2])
    );
    expect(citations).toEqual([]);
    expect(rejected).toEqual([{ indicatorId: 'IND-000001', code: 'citation_not_cross_surface' }]);
  });

  it('rejects cited ids absent from the cluster without inventing', () => {
    const fb = makeObs('obs-fb-1', 'facebook', 'world', '2026-06-01T12:00:00.000Z', true);
    const known = makeDomain('IND-000001', 'bills.example', ['obs-fb-1']);
    const elsewhere = makeDomain('IND-000002', 'other.example', ['obs-fb-1']);
    const cluster = makeCluster({ id: 'CLU-000001', indicatorIds: ['IND-000001'], observationIds: ['obs-fb-1'] });
    const { citations, rejected } = resolveCitations(
      cluster,
      ['IND-999999', 'IND-000002'],
      'whatsapp',
      NOW,
      lookups([known, elsewhere], [fb])
    );
    expect(citations).toEqual([]);
    expect(rejected).toEqual([
      { indicatorId: 'IND-999999', code: 'citation_unknown_indicator' },
      { indicatorId: 'IND-000002', code: 'citation_unknown_indicator' }
    ]);
  });

  it('skips an expired earliest observation for the next eligible one', () => {
    const old = makeObs('obs-fb-old', 'facebook', 'world', '2026-04-01T12:00:00.000Z', true);
    const fresh = makeObs('obs-msg-1', 'messenger', 'world', '2026-06-09T12:00:00.000Z', true);
    const domain = makeDomain('IND-000001', 'bills.example', ['obs-fb-old', 'obs-msg-1']);
    const cluster = makeCluster({
      id: 'CLU-000001',
      indicatorIds: ['IND-000001'],
      observationIds: ['obs-fb-old', 'obs-msg-1']
    });
    const { citations, rejected } = resolveCitations(
      cluster,
      ['IND-000001'],
      'whatsapp',
      NOW,
      lookups([domain], [old, fresh])
    );
    expect(rejected).toEqual([]);
    expect(citations).toHaveLength(1);
    expect(citations[0].observationId).toBe('obs-msg-1');
  });

  it('resolves nothing when every observation is expired', () => {
    const old = makeObs('obs-fb-old', 'facebook', 'world', '2026-04-01T12:00:00.000Z', true);
    const domain = makeDomain('IND-000001', 'bills.example', ['obs-fb-old']);
    const cluster = makeCluster({
      id: 'CLU-000001',
      indicatorIds: ['IND-000001'],
      observationIds: ['obs-fb-old']
    });
    const { citations, rejected } = resolveCitations(
      cluster,
      ['IND-000001'],
      'whatsapp',
      NOW,
      lookups([domain], [old])
    );
    expect(citations).toEqual([]);
    expect(rejected).toEqual([{ indicatorId: 'IND-000001', code: 'citation_not_cross_surface' }]);
  });
});

describe('buildCard', () => {
  function contextFixtures() {
    const fb1 = makeObs('obs-fb-1', 'facebook', 'world', '2026-06-01T12:00:00.000Z', true);
    const fb2 = makeObs('obs-fb-2', 'facebook', 'world', '2026-06-01T13:00:00.000Z', true);
    const m1 = makeObs('obs-m-1', 'messenger', 'world', '2026-06-01T14:00:00.000Z', true);
    const m2 = makeObs('obs-m-2', 'messenger', 'world', '2026-06-01T15:00:00.000Z', true);
    const d1 = makeDomain('IND-000001', 'bills.example', ['obs-fb-1', 'obs-m-1']);
    const d2 = makeDomain('IND-000002', 'verify.example', ['obs-fb-2', 'obs-m-2']);
    const cluster = makeCluster({
      id: 'CLU-000001',
      indicatorIds: ['IND-000001', 'IND-000002'],
      surfaces: ['facebook', 'messenger'],
      observationIds: ['obs-fb-1', 'obs-fb-2', 'obs-m-1', 'obs-m-2'],
      familyCount: 1,
      perSurfaceCounts: { facebook: 2, messenger: 2 },
      tierInputs: { crossSurfacePairs: [['facebook', 'messenger']], families: ['domain'], hasConfirmedIndicator: false }
    });
    return { cluster, indicators: [d1, d2], observations: [fb1, fb2, m1, m2] };
  }

  it('emits a context card from two surfaces with resolved citations', async () => {
    const { cluster, indicators, observations } = contextFixtures();
    const dir = makeRunDir();
    const card = await buildCard(cluster, {
      indicators,
      observations,
      cardSurface: 'messenger',
      runDir: dir,
      nowMs: NOW,
      propose: stubPropose(emitProposal({ citations: ['IND-000001', 'IND-000002'] }))
    });
    expect(card).not.toBeNull();
    const emitted = card as Card;
    expect(emitted.tier).toBe('context');
    expect(emitted.surface).toBe('messenger');
    expect(emitted.citations).toHaveLength(2);
    expect(emitted.citations.map((c) => c.surface)).toEqual(['facebook', 'facebook']);
    expect(emitted.citations.map((c) => c.observationId)).toEqual(['obs-fb-1', 'obs-fb-2']);
    expect(emitted.provenance.sources).toEqual(['world']);
    expect(emitted.provenance.synthetic).toBe(true);
    expect(emitted.provenance.evidenceBasis).toBe('observed');
    expect(emitted.provenance.attribution).toBeUndefined();
    expect(emitted.provenance.proposedTier).toBe('context');
    expect(emitted.provenance.dropped).toEqual([]);
    expect(emitted.provenance.model).toBe('muse-spark-1.3-contributor');
    expect(emitted.provenance.promptVersion).toBe('card.v1');
    const lines = readCards(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual(emitted);
  });

  it('emits a corroborated card across families with the handle variant displayed', async () => {
    const fb1 = makeObs('obs-fb-1', 'facebook', 'world', '2026-06-01T12:00:00.000Z', true);
    const fb2 = makeObs('obs-fb-2', 'facebook', 'world', '2026-06-01T13:00:00.000Z', true);
    const m1 = makeObs('obs-m-1', 'messenger', 'world', '2026-06-01T14:00:00.000Z', true);
    const w1 = makeObs('obs-w-1', 'whatsapp', 'world', '2026-06-02T12:00:00.000Z', true);
    const domain = makeDomain('IND-000001', 'bills.example', ['obs-fb-1', 'obs-m-1']);
    const handle = makeHandle('IND-000002', 'bright.cart', 'Bright.Cart', ['obs-fb-2', 'obs-w-1']);
    const cluster = makeCluster({
      id: 'CLU-000002',
      indicatorIds: ['IND-000001', 'IND-000002'],
      surfaces: ['facebook', 'messenger', 'whatsapp'],
      observationIds: ['obs-fb-1', 'obs-fb-2', 'obs-m-1', 'obs-w-1'],
      familyCount: 2,
      tierInputs: {
        crossSurfacePairs: [
          ['facebook', 'messenger'],
          ['facebook', 'whatsapp']
        ],
        families: ['domain', 'payment_handle'],
        hasConfirmedIndicator: false
      }
    });
    const dir = makeRunDir();
    const card = await buildCard(cluster, {
      indicators: [domain, handle],
      observations: [fb1, fb2, m1, w1],
      cardSurface: 'messenger',
      runDir: dir,
      nowMs: NOW,
      propose: stubPropose(emitProposal({ tier: 'corroborated', citations: ['IND-000001', 'IND-000002'] }))
    });
    expect(card?.tier).toBe('corroborated');
    expect(card?.provenance.evidenceBasis).toBe('observed');
    const displays = (card as Card).citations.map((c) => c.display);
    expect(displays).toContain('Bright.Cart');
  });

  it('emits a confirmed card from feed plus submission with attribution', async () => {
    const feed1 = makeObs('obs-feed-1', 'public_feed', 'public_feed', '2026-06-05T12:00:00.000Z', false, 'public_source');
    const feed2 = makeObs('obs-feed-2', 'public_feed', 'public_feed', '2026-06-06T12:00:00.000Z', false, 'public_source');
    const sub = makeObs('obs-sub-1', 'user_submission', 'submission', '2026-06-09T12:00:00.000Z', false, 'user_submitted');
    const d1 = makeDomain('IND-000001', 'evil.example', ['obs-feed-1', 'obs-sub-1']);
    const d2 = makeDomain('IND-000002', 'evil2.example', ['obs-feed-2', 'obs-sub-1']);
    const cluster = makeCluster({
      id: 'CLU-000003',
      indicatorIds: ['IND-000001', 'IND-000002'],
      surfaces: ['public_feed', 'user_submission'],
      observationIds: ['obs-feed-1', 'obs-feed-2', 'obs-sub-1'],
      familyCount: 1,
      claimCodes: ['public_blocklist'],
      syntheticAll: false,
      tierInputs: {
        crossSurfacePairs: [['public_feed', 'user_submission']],
        families: ['domain'],
        hasConfirmedIndicator: true
      }
    });
    const feedRecords = new Map<string, FeedAttribution>([
      ['obs-feed-1', { feedName: 'example-feed', publishedAt: '2026-06-05T12:00:00.000Z', assertedClaim: 'listing' }],
      ['obs-feed-2', { feedName: 'example-feed', publishedAt: '2026-06-06T12:00:00.000Z', assertedClaim: 'listing' }]
    ]);
    const dir = makeRunDir();
    const card = await buildCard(cluster, {
      indicators: [d1, d2],
      observations: [feed1, feed2, sub],
      cardSurface: 'user_submission',
      runDir: dir,
      nowMs: NOW,
      feedRecords,
      propose: stubPropose(
        emitProposal({
          tier: 'confirmed',
          headline: 'This link is on a public blocklist.',
          citations: ['IND-000001', 'IND-000002']
        })
      )
    });
    expect(card?.tier).toBe('confirmed');
    const emitted = card as Card;
    expect(emitted.provenance.evidenceBasis).toBe('source_reported');
    expect(emitted.provenance.synthetic).toBe(false);
    expect(emitted.provenance.sources).toEqual(['public_feed', 'submission']);
    expect(emitted.provenance.attribution).toEqual({
      feedName: 'example-feed',
      publishedAt: '2026-06-05T12:00:00.000Z',
      assertedClaim: 'listing'
    });
    expect(emitted.citations.map((c) => c.observationId)).toEqual(['obs-feed-1', 'obs-feed-2']);
  });

  it('goes silent with no_resolvable_citations and writes no renderable output', async () => {
    const { cluster, indicators, observations } = contextFixtures();
    const dir = makeRunDir();
    const card = await buildCard(cluster, {
      indicators,
      observations,
      cardSurface: 'messenger',
      runDir: dir,
      nowMs: NOW,
      propose: stubPropose(emitProposal({ citations: ['IND-999999'] }))
    });
    expect(card).toBeNull();
    const lines = readCards(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      declined: true,
      clusterId: 'CLU-000001',
      reason: 'no_resolvable_citations',
      proposedTier: 'context',
      rejected: [{ indicatorId: 'IND-999999', code: 'citation_unknown_indicator' }]
    });
    for (const line of lines) {
      expect(line).not.toHaveProperty('tier');
    }
  });

  it('builds from resolved citations only when the model over-claims', async () => {
    const { cluster, indicators, observations } = contextFixtures();
    const dir = makeRunDir();
    const overclaim = emitProposal({
      tier: 'confirmed',
      headline: 'This account is a scam operation.',
      body: 'You lost $500 to this fraudster. Pay nothing more.',
      citations: ['IND-000001', 'IND-000002', 'IND-999999']
    });
    const card = await buildCard(cluster, {
      indicators,
      observations,
      cardSurface: 'messenger',
      runDir: dir,
      nowMs: NOW,
      propose: stubPropose(overclaim)
    });
    // P4 resolves evidence; judging the prose is the validator's job (P5), so
    // the over-claimed copy passes through verbatim while the unknown id does not.
    expect(card).not.toBeNull();
    const emitted = card as Card;
    expect(emitted.citations.map((c) => c.indicatorId)).toEqual(['IND-000001', 'IND-000002']);
    expect(emitted.body).toBe(overclaim.body);
    expect(emitted.provenance.dropped).toEqual([
      { rule: 'V1', text: 'IND-999999', reason: 'citation_unknown_indicator' }
    ]);
  });

  it('writes a declined record and returns nothing when the model declines', async () => {
    const { cluster, indicators, observations } = contextFixtures();
    const dir = makeRunDir();
    const card = await buildCard(cluster, {
      indicators,
      observations,
      cardSurface: 'messenger',
      runDir: dir,
      nowMs: NOW,
      propose: stubPropose({
        decision: 'decline',
        tier: null,
        headline: null,
        body: null,
        safeAction: null,
        citations: [],
        declineReason: 'single_family',
        confidence: 0.7
      })
    });
    expect(card).toBeNull();
    const lines = readCards(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      declined: true,
      clusterId: 'CLU-000001',
      reason: 'single_family',
      proposedTier: null
    });
  });

  it('declines without calling the model when the cluster is ineligible', async () => {
    const fb = makeObs('obs-fb-1', 'facebook', 'world', '2026-06-01T12:00:00.000Z', true);
    const domain = makeDomain('IND-000001', 'bills.example', ['obs-fb-1']);
    const cluster = makeCluster({
      id: 'CLU-000009',
      indicatorIds: ['IND-000001'],
      surfaces: ['facebook'],
      observationIds: ['obs-fb-1']
    });
    let called = false;
    const spy: ProposeFn = async () => {
      called = true;
      return { ok: true, data: emitProposal(), usage: { inputTokens: 0, outputTokens: 0 }, ms: 0 };
    };
    const dir = makeRunDir();
    const card = await buildCard(cluster, {
      indicators: [domain],
      observations: [fb],
      cardSurface: 'messenger',
      runDir: dir,
      nowMs: NOW,
      propose: spy
    });
    expect(card).toBeNull();
    expect(called).toBe(false);
    expect(readCards(dir)).toHaveLength(1);
    expect(readCards(dir)[0]).toMatchObject({ declined: true, reason: 'ineligible_cluster' });
  });

  it('declines with the transport code when the model call fails', async () => {
    const { cluster, indicators, observations } = contextFixtures();
    const dir = makeRunDir();
    const card = await buildCard(cluster, {
      indicators,
      observations,
      cardSurface: 'messenger',
      runDir: dir,
      nowMs: NOW,
      propose: stubTimeout
    });
    expect(card).toBeNull();
    expect(readCards(dir)[0]).toMatchObject({ declined: true, reason: 'timeout' });
  });

  it('hands the candidate to the validator and honors a rejection', async () => {
    const { cluster, indicators, observations } = contextFixtures();
    const dir = makeRunDir();
    const card = await buildCard(cluster, {
      indicators,
      observations,
      cardSurface: 'messenger',
      runDir: dir,
      nowMs: NOW,
      propose: stubPropose(emitProposal({ citations: ['IND-000001', 'IND-000002'] })),
      validate: (candidate) => ({
        card: null,
        dropped: [{ rule: 'V5', text: candidate.headline, reason: 'guilt_token' }],
        finalTier: null,
        demotions: []
      })
    });
    expect(card).toBeNull();
    expect(readCards(dir)[0]).toMatchObject({
      declined: true,
      reason: 'validator_rejected',
      dropped: [{ rule: 'V5', text: "This request is linked to an ad you didn't see.", reason: 'guilt_token' }]
    });
  });

  it('merges validator demotions into the emitted card', async () => {
    const { cluster, indicators, observations } = contextFixtures();
    const dir = makeRunDir();
    const card = await buildCard(cluster, {
      indicators,
      observations,
      cardSurface: 'messenger',
      runDir: dir,
      nowMs: NOW,
      propose: stubPropose(emitProposal({ tier: 'corroborated', citations: ['IND-000001', 'IND-000002'] })),
      validate: (candidate) => ({
        card: { ...candidate, tier: 'context' },
        dropped: [{ rule: 'V9', text: 'tier', reason: 'demoted' }],
        finalTier: 'context',
        demotions: ['corroborated->context']
      })
    });
    expect(card?.tier).toBe('context');
    expect((card as Card).provenance.dropped).toEqual([{ rule: 'V9', text: 'tier', reason: 'demoted' }]);
    expect((card as Card).provenance.proposedTier).toBe('corroborated');
  });

  it('gathers evidence from a real store through the id lookups', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metshield-store-'));
    const store = new Store('run-1', { root, now: () => NOW });
    const base = {
      source: 'world' as const,
      observedAt: '2026-06-09T12:00:00.000Z',
      eventKind: 'message' as const,
      actorRef: 'FB-1',
      subjectRef: null,
      threadRef: null,
      indicators: [{ kind: 'offplatform_link' as const, value: 'https://bills.example/pay' }],
      claimCodes: [] as string[],
      consent: 'none' as const,
      synthetic: true
    };
    expect(store.record({ ...base, id: 'obs-fb-1', surface: 'facebook' }).accepted).toBe(true);
    expect(store.record({ ...base, id: 'obs-m-1', surface: 'messenger' }).accepted).toBe(true);
    const clusters = store.getClusters();
    expect(clusters).toHaveLength(1);
    const found = clusters[0];
    const indicators: StoredIndicator[] = [];
    for (const id of found.indicatorIds) {
      const stored = store.getIndicatorById(id);
      expect(stored).toBeDefined();
      if (stored !== undefined) indicators.push(stored);
    }
    const observations: StoredObservation[] = [];
    for (const id of found.observationIds) {
      const stored = store.getObservation(id);
      expect(stored).toBeDefined();
      if (stored !== undefined) observations.push(stored);
    }
    expect(store.getIndicatorById('IND-999999')).toBeUndefined();
    expect(store.getObservation('obs-missing')).toBeUndefined();
    const card = await buildCard(found, {
      indicators,
      observations,
      cardSurface: 'messenger',
      runDir: path.join(root, 'run-1'),
      nowMs: NOW,
      propose: stubPropose(emitProposal({ citations: found.indicatorIds }))
    });
    // One shared indicator resolves to one citation; the two-citation floor is
    // the validator's V3 in P5, not the builder's.
    expect(card?.citations).toHaveLength(1);
    expect(card?.provenance.evidenceBasis).toBe('observed');
  });
});

describe('card prompt', () => {
  it('pins the version and the five templates', () => {
    expect(CARD_PROMPT_VERSION).toBe('card.v1');
    for (const headline of [
      "This request is linked to an ad you didn't see.",
      'The link in this chat also ran as a paid ad.',
      'This payment handle is used by more than one account.',
      'The account asking for your code ran ads for this offer.',
      'This link is on a public blocklist.'
    ]) {
      expect(CARD_SYSTEM_PROMPT).toContain(headline);
    }
    expect(CARD_SYSTEM_PROMPT).toContain('indicator ids present');
    expect(CARD_SYSTEM_PROMPT).toContain('silence');
    expect(CARD_SYSTEM_PROMPT).toContain('guilt');
    expect(CARD_SYSTEM_PROMPT).toContain('320');
  });
});
