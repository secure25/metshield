import { describe, expect, it } from 'vitest';
import type { ObservationSurface } from '../src/contract.js';
import type { Cluster } from '../src/correlate.js';
import type { Card, Citation } from '../src/cards.js';
import { CARD_TEMPLATES_V1 } from '../src/copy/card.v1.js';
import { CARD_SYSTEM_PROMPT } from '../src/models/prompts/card.v1.js';
import { validateCard } from '../src/validate.js';

const NOW = Date.parse('2026-06-10T12:00:00.000Z');
const T1 = '2026-06-01T12:00:00.000Z';
const T2 = '2026-06-02T12:00:00.000Z';
const FEED_PUBLISHED_AT = '2026-06-05T12:00:00.000Z';

const A_HEADLINE = "This request is linked to an ad you didn't see.";
const A_S1 = "The domain in this chat also appeared in 2 facebook events we've linked to the same operation.";
const A_S2 = 'The warning above already applies — this is why it may also be happening elsewhere.';
const F_S2 =
  'That listing is the whole of our evidence — we have not seen it in a conversation or in an ad, and a listing is a claim about the domain, not proof about every use of it.';

function aBody(family: string, n: number, surface: string): string {
  return `The ${family} in this chat also appeared in ${n} ${surface} events we've linked to the same operation. ${A_S2}`;
}

function fBody(feedName: string, publishedAgo: string): string {
  return `This domain is listed in ${feedName}'s reported-scam feed, published ${publishedAgo}. ${F_S2}`;
}

function cit(id: string, surface: ObservationSurface, observedAt: string, obsId: string): Citation {
  return { indicatorId: id, family: 'domain', display: 'bills.example', surface, observedAt, observationId: obsId };
}

function baseCluster(overrides: Partial<Cluster> = {}): Cluster {
  return {
    id: 'CLU-000001',
    indicatorIds: ['IND-000001', 'IND-000002'],
    surfaces: ['facebook', 'messenger'],
    observationIds: ['obs-fb-1', 'obs-fb-2', 'obs-m-1'],
    familyCount: 1,
    claimCodes: [],
    firstSeenAt: T1,
    lastSeenAt: T2,
    perSurfaceCounts: { facebook: 2, messenger: 1 },
    syntheticAll: true,
    tierInputs: {
      crossSurfacePairs: [['facebook', 'messenger']],
      families: ['domain'],
      hasConfirmedIndicator: false
    },
    ...overrides
  };
}

function threeCits(): Citation[] {
  return [
    cit('IND-000001', 'facebook', T1, 'obs-fb-1'),
    cit('IND-000002', 'facebook', T2, 'obs-fb-2'),
    cit('IND-000003', 'whatsapp', T2, 'obs-w-1')
  ];
}

function threeCitCluster(): Cluster {
  return baseCluster({
    indicatorIds: ['IND-000001', 'IND-000002', 'IND-000003'],
    surfaces: ['facebook', 'messenger', 'whatsapp'],
    observationIds: ['obs-fb-1', 'obs-fb-2', 'obs-m-1', 'obs-w-1'],
    perSurfaceCounts: { facebook: 2, messenger: 1, whatsapp: 1 }
  });
}

function baseCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'CARD-000001',
    clusterId: 'CLU-000001',
    tier: 'corroborated',
    surface: 'messenger',
    headline: A_HEADLINE,
    body: aBody('domain', 2, 'facebook'),
    safeAction: 'leave_and_report',
    citations: [cit('IND-000001', 'facebook', T1, 'obs-fb-1'), cit('IND-000002', 'facebook', T2, 'obs-fb-2')],
    provenance: {
      sources: ['world'],
      synthetic: true,
      evidenceBasis: 'observed',
      proposedTier: 'corroborated',
      dropped: [],
      model: 'muse-spark-1.3-contributor',
      promptVersion: 'card.v1'
    },
    createdAt: '2026-06-10T12:00:00.000Z',
    expiresAt: '2026-06-13T12:00:00.000Z',
    ...overrides
  };
}

function feedProvenance(feedName: string): Card['provenance'] {
  return {
    sources: ['public_feed', 'submission'],
    synthetic: false,
    evidenceBasis: 'source_reported',
    attribution: { feedName, publishedAt: FEED_PUBLISHED_AT, assertedClaim: 'listing' },
    proposedTier: 'confirmed',
    dropped: [],
    model: 'muse-spark-1.3-contributor',
    promptVersion: 'card.v1'
  };
}

function feedCluster(overrides: Partial<Cluster> = {}): Cluster {
  return baseCluster({
    id: 'CLU-000003',
    indicatorIds: ['IND-000001', 'IND-000002'],
    surfaces: ['public_feed', 'user_submission'],
    observationIds: ['obs-feed-1', 'obs-feed-2', 'obs-sub-1'],
    claimCodes: ['public_blocklist'],
    perSurfaceCounts: { public_feed: 2, user_submission: 1 },
    syntheticAll: false,
    tierInputs: {
      crossSurfacePairs: [['public_feed', 'user_submission']],
      families: ['domain'],
      hasConfirmedIndicator: true
    },
    ...overrides
  });
}

function feedCard(overrides: Partial<Card> = {}): Card {
  return baseCard({
    clusterId: 'CLU-000003',
    tier: 'confirmed',
    surface: 'user_submission',
    headline: 'This link is on a public blocklist.',
    body: fBody('example-feed', '5 days ago'),
    citations: [
      cit('IND-000001', 'public_feed', '2026-06-05T12:00:00.000Z', 'obs-feed-1'),
      cit('IND-000002', 'public_feed', '2026-06-06T12:00:00.000Z', 'obs-feed-2')
    ],
    provenance: feedProvenance('example-feed'),
    ...overrides
  });
}

describe('validate', () => {
  it('passes a clean card with no drops', () => {
    const result = validateCard(baseCard(), baseCluster(), NOW);
    expect(result.card).not.toBeNull();
    expect(result.dropped).toEqual([]);
    expect(result.finalTier).toBe('corroborated');
    expect(result.demotions).toEqual([]);
    expect(result.card?.body).toBe(aBody('domain', 2, 'facebook'));
    expect(result.card?.citations).toHaveLength(2);
  });

  it('V1 drops a citation for an indicator outside the cluster', () => {
    const card = baseCard({
      citations: [
        cit('IND-000001', 'facebook', T1, 'obs-fb-1'),
        cit('IND-000002', 'facebook', T2, 'obs-fb-2'),
        cit('IND-999999', 'facebook', T1, 'obs-fb-9')
      ]
    });
    const result = validateCard(card, baseCluster(), NOW);
    expect(result.card).not.toBeNull();
    expect(result.card?.citations.map((c) => c.indicatorId)).toEqual(['IND-000001', 'IND-000002']);
    expect(result.dropped).toEqual([{ rule: 'V1', text: 'IND-999999', reason: 'unknown_indicator' }]);
  });

  it('V2 drops a wrong-surface citation and nothing else', () => {
    const card = baseCard({
      citations: [
        cit('IND-000001', 'facebook', T1, 'obs-fb-1'),
        cit('IND-000002', 'facebook', T2, 'obs-fb-2'),
        cit('IND-000003', 'messenger', T2, 'obs-m-1')
      ]
    });
    const cluster = baseCluster({ indicatorIds: ['IND-000001', 'IND-000002', 'IND-000003'] });
    const result = validateCard(card, cluster, NOW);
    expect(result.card).not.toBeNull();
    expect(result.card?.citations).toHaveLength(2);
    expect(result.dropped).toEqual([{ rule: 'V2', text: 'IND-000003', reason: 'same_surface' }]);
  });

  it('goes silent when its only citation is on its own surface', () => {
    const card = baseCard({ citations: [cit('IND-000001', 'messenger', T1, 'obs-m-1')] });
    const result = validateCard(card, baseCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.finalTier).toBeNull();
    expect(result.dropped.map((d) => d.rule)).toEqual(['V2', 'V3']);
  });

  it('V3 silences a card with one valid citation', () => {
    const card = baseCard({ citations: [cit('IND-000001', 'facebook', T1, 'obs-fb-1')] });
    const result = validateCard(card, baseCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.dropped).toEqual([{ rule: 'V3', text: 'citations', reason: 'below_floor' }]);
  });

  it('V4a drops a paraphrased sentence while the rest survives', () => {
    const card = baseCard({
      body: `${A_S1} Something else entirely happened here.`,
      citations: threeCits()
    });
    const result = validateCard(card, threeCitCluster(), NOW);
    expect(result.card).not.toBeNull();
    expect(result.card?.body).toBe(A_S1);
    expect(result.finalTier).toBe('corroborated');
    expect(result.demotions).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].rule).toBe('V4a');
  });

  it('V4b drops a template sentence with an unsupported slot and nothing else', () => {
    const card = baseCard({ body: aBody('lizard', 2, 'facebook'), citations: threeCits() });
    const result = validateCard(card, threeCitCluster(), NOW);
    expect(result.card).not.toBeNull();
    expect(result.card?.body).toBe(A_S2);
    expect(result.finalTier).toBe('corroborated');
    expect(result.dropped).toEqual([{ rule: 'V4b', text: 'lizard', reason: 'slot family unresolved' }]);
  });

  it('V5 drops a template-valid sentence carrying a banned token', () => {
    const cluster = feedCluster({
      indicatorIds: ['IND-000001', 'IND-000002', 'IND-000003'],
      observationIds: ['obs-feed-1', 'obs-feed-2', 'obs-feed-3', 'obs-sub-1'],
      perSurfaceCounts: { public_feed: 3, user_submission: 1 }
    });
    const card = feedCard({
      body: fBody('scam watch', '5 days ago'),
      citations: [
        cit('IND-000001', 'public_feed', '2026-06-05T12:00:00.000Z', 'obs-feed-1'),
        cit('IND-000002', 'public_feed', '2026-06-06T12:00:00.000Z', 'obs-feed-2'),
        cit('IND-000003', 'public_feed', '2026-06-07T12:00:00.000Z', 'obs-feed-3')
      ],
      provenance: feedProvenance('scam watch')
    });
    const result = validateCard(card, cluster, NOW);
    expect(result.card).not.toBeNull();
    expect(result.card?.body).toBe(F_S2);
    expect(result.finalTier).toBe('confirmed');
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].rule).toBe('V5');
  });

  it('V6 rejects a card with a bad tier', () => {
    const card = { ...baseCard(), tier: 'bogus' } as unknown as Card;
    const result = validateCard(card, baseCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.dropped).toEqual([{ rule: 'V6', text: 'bogus', reason: 'bad_tier' }]);
  });

  it('V6 rejects a card with a bad safeAction', () => {
    const card = { ...baseCard(), safeAction: 'bogus' } as unknown as Card;
    const result = validateCard(card, baseCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.dropped).toEqual([{ rule: 'V6', text: 'bogus', reason: 'bad_safe_action' }]);
  });

  it('V7 rejects a headline over 90 characters', () => {
    const card = baseCard({ headline: 'x'.repeat(91) });
    const result = validateCard(card, baseCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.dropped).toEqual([{ rule: 'V7', text: 'headline', reason: 'headline_too_long' }]);
  });

  it('V7 rejects a body over 320 characters', () => {
    const card = baseCard({ body: 'y'.repeat(321) });
    const result = validateCard(card, baseCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.dropped).toEqual([{ rule: 'V7', text: 'body', reason: 'body_too_long' }]);
  });

  it('V8 drops an invented count and V9 demotes one tier', () => {
    const card = baseCard({ body: aBody('domain', 99, 'facebook') });
    const result = validateCard(card, baseCluster(), NOW);
    expect(result.card).not.toBeNull();
    expect(result.card?.body).toBe(A_S2);
    expect(result.card?.tier).toBe('context');
    expect(result.finalTier).toBe('context');
    expect(result.demotions).toEqual(['corroborated->context']);
    expect(result.dropped).toEqual([{ rule: 'V8', text: '99', reason: 'slot n unresolved_numeral' }]);
  });

  it('V9 below context goes silent instead of emitting a weakened card', () => {
    const card = baseCard({ tier: 'context', body: `${A_S1} Something else entirely happened here.` });
    const result = validateCard(card, baseCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.finalTier).toBeNull();
    expect(result.demotions).toEqual(['context->silent']);
    expect(result.dropped.map((d) => d.rule)).toEqual(['V4a', 'V9']);
  });

  it('V10 silences a card whose every body sentence drops', () => {
    const card = baseCard({ body: 'Something else happened. Nothing to see here.' });
    const result = validateCard(card, baseCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.dropped.map((d) => d.rule)).toEqual(['V4a', 'V4a', 'V10']);
  });

  it('V10 silences a card whose headline drops', () => {
    const card = baseCard({ headline: 'Something alarming happened.' });
    const result = validateCard(card, baseCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.dropped.map((d) => d.rule)).toEqual(['V4a', 'V10']);
  });

  it('V11 rejects a source_reported card with no attribution', () => {
    const { attribution: _drop, ...provenance } = feedCard().provenance;
    void _drop;
    const card = feedCard({ provenance });
    const result = validateCard(card, feedCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.dropped).toEqual([
      { rule: 'V11', text: 'attribution', reason: 'missing_or_invalid_attribution' }
    ]);
  });

  it('V11 rejects a published-time slot no evidence supplies', () => {
    const card = feedCard({ body: fBody('example-feed', '9 days ago') });
    const result = validateCard(card, feedCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.dropped).toEqual([{ rule: 'V11', text: 'feed_slots', reason: 'unresolved_feed_slots' }]);
  });

  it('V11 rejects a feed card that also asserts a product observation', () => {
    const fS1 = "This domain is listed in example-feed's reported-scam feed, published 5 days ago.";
    const card = feedCard({ body: `${fS1} ${A_S1}` });
    const result = validateCard(card, feedCluster(), NOW);
    expect(result.card).toBeNull();
    expect(result.dropped).toEqual([{ rule: 'V11', text: A_S1, reason: 'product_surface_assertion' }]);
  });

  describe.each([
    { id: 'A', make: (): { card: Card; cluster: Cluster } => ({ card: baseCard(), cluster: baseCluster() }) },
    {
      id: 'B',
      make: (): { card: Card; cluster: Cluster } => ({
        card: baseCard({
          headline: 'The link in this chat also ran as a paid ad.',
          body: 'We saw this domain in an ad 3 hours ago. Leaving the app to pay or enter details is how this pattern usually works.',
          citations: [
            cit('IND-000001', 'facebook', '2026-06-10T09:00:00.000Z', 'obs-fb-1'),
            cit('IND-000002', 'facebook', T2, 'obs-fb-2')
          ]
        }),
        cluster: baseCluster()
      })
    },
    {
      id: 'C',
      make: (): { card: Card; cluster: Cluster } => ({
        card: baseCard({
          headline: 'This payment handle is used by more than one account.',
          body: "The same handle was used in 3 conversations we've linked. A handle shared this way is not a person you've verified."
        }),
        cluster: baseCluster()
      })
    },
    {
      id: 'D',
      make: (): { card: Card; cluster: Cluster } => ({
        card: baseCard({
          headline: 'The account asking for your code ran ads for this offer.',
          body: 'Nobody legitimate needs the code sent to your phone. If it was already shared, change your password and sign out other sessions.'
        }),
        cluster: baseCluster()
      })
    },
    {
      id: 'E',
      make: (): { card: Card; cluster: Cluster } => ({
        card: baseCard({
          tier: 'context',
          headline: 'No card emitted.',
          body: 'Reason: insufficient_cross_surface. 2 indicators, 2 surfaces. Below the cross-surface threshold.'
        }),
        cluster: baseCluster()
      })
    },
    {
      id: 'F',
      make: (): { card: Card; cluster: Cluster } => ({ card: feedCard(), cluster: feedCluster() })
    }
  ])('template $id', ({ make }) => {
    it('passes unchanged', () => {
      const { card, cluster } = make();
      const result = validateCard(card, cluster, NOW);
      expect(result.card).not.toBeNull();
      expect(result.dropped).toEqual([]);
    });
  });

  it('template literals carry no digits, so V8 sees every numeral', () => {
    for (const template of CARD_TEMPLATES_V1) {
      for (const text of [template.headline, ...template.body]) {
        const literal = text.replace(/\{\w+\}/g, '');
        expect(literal, template.id).not.toMatch(/\d/);
      }
    }
  });

  it('prompt and validator share the same copy', () => {
    for (const template of CARD_TEMPLATES_V1) {
      if (template.id === 'E') {
        expect(CARD_SYSTEM_PROMPT).not.toContain(template.headline);
        for (const sentence of template.body) {
          expect(CARD_SYSTEM_PROMPT).not.toContain(sentence);
        }
      } else {
        expect(CARD_SYSTEM_PROMPT).toContain(template.headline);
        for (const sentence of template.body) {
          expect(CARD_SYSTEM_PROMPT).toContain(sentence);
        }
      }
    }
  });
});
