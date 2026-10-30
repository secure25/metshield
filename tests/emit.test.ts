import { describe, expect, it } from 'vitest';
import type { IndicatorFamily, ObservationSurface } from '../src/contract.js';
import type { Card, Citation } from '../src/cards.js';
import type { StoredObservation } from '../src/store.js';
import { EmitError, privacyLineFor, toSurfacePayload, toWorldAction } from '../src/emit.js';

const NOW = Date.parse('2026-06-10T12:00:00.000Z');
const T1 = '2026-06-01T12:00:00.000Z';
const T2 = '2026-06-02T12:00:00.000Z';

const HEADLINE = "This request is linked to an ad you didn't see.";
const BODY =
  "The domain in this chat also appeared in 2 facebook events we've linked to the same operation. The warning above already applies — this is why it may also be happening elsewhere.";

function cit(
  id: string,
  surface: ObservationSurface,
  observedAt: string,
  obsId: string,
  family: IndicatorFamily = 'domain',
  display: string = 'bills.example'
): Citation {
  return { indicatorId: id, family, display, surface, observedAt, observationId: obsId };
}

function baseCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'CARD-000001',
    clusterId: 'CLU-000001',
    tier: 'corroborated',
    surface: 'messenger',
    headline: HEADLINE,
    body: BODY,
    safeAction: 'leave_and_report',
    citations: [
      cit('IND-000001', 'facebook', T1, 'obs-fb-1', 'domain', 'bills.example'),
      cit('IND-000002', 'facebook', T2, 'obs-fb-2', 'domain', 'verify.example')
    ],
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

function feedCard(): Card {
  return baseCard({
    tier: 'confirmed',
    surface: 'user_submission',
    headline: 'This link is on a public blocklist.',
    body: "This domain is listed in example-feed's reported-scam feed, published 5 days ago. That listing is the whole of our evidence — we have not seen it in a conversation or in an ad, and a listing is a claim about the domain, not proof about every use of it.",
    citations: [
      cit('IND-000001', 'public_feed', '2026-06-05T12:00:00.000Z', 'obs-feed-1'),
      cit('IND-000002', 'public_feed', '2026-06-06T12:00:00.000Z', 'obs-feed-2')
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
    }
  });
}

function makeStoredObs(id: string, externalRef?: string): StoredObservation {
  return {
    observation: {
      id,
      ...(externalRef === undefined ? {} : { externalRef }),
      source: 'world',
      observedAt: T1,
      surface: 'facebook',
      eventKind: 'message',
      actorRef: 'actor-1',
      subjectRef: null,
      threadRef: null,
      indicators: [],
      claimCodes: [],
      consent: 'none',
      synthetic: true
    },
    normalizedClaimCodes: [],
    acceptedAt: T1
  };
}

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringsOf);
  return [];
}

function hasStandaloneScam(text: string): boolean {
  const lower = text.toLowerCase();
  let idx = lower.indexOf('scam');
  while (idx !== -1) {
    const before = idx === 0 ? '' : lower[idx - 1];
    const after = idx + 4 >= lower.length ? '' : lower[idx + 4];
    if (!/[a-z0-9-]/.test(before) && !/[a-z0-9-]/.test(after)) return true;
    idx = lower.indexOf('scam', idx + 1);
  }
  return false;
}

describe('emit', () => {
  it.each([
    { tier: 'context', severity: 'info', dismissible: true },
    { tier: 'corroborated', severity: 'caution', dismissible: true },
    { tier: 'confirmed', severity: 'warning', dismissible: false }
  ] as const)('tier $tier renders $severity, dismissible=$dismissible', ({ tier, severity, dismissible }) => {
    const payload = toSurfacePayload(baseCard({ tier }), NOW);
    expect(payload.severity).toBe(severity);
    expect(payload.dismissible).toBe(dismissible);
  });

  it('names one family once even when cited twice', () => {
    const payload = toSurfacePayload(baseCard(), NOW);
    expect(payload.privacyLine).toBe('MetShield matched a domain across products. It did not read your messages.');
  });

  it('joins two families with and', () => {
    const card = baseCard({
      citations: [
        cit('IND-000001', 'facebook', T1, 'obs-fb-1', 'domain', 'bills.example'),
        cit('IND-000002', 'facebook', T2, 'obs-fb-2', 'payment_handle', 'Bright.Cart')
      ]
    });
    const payload = toSurfacePayload(card, NOW);
    expect(payload.privacyLine).toBe(
      'MetShield matched a domain and a payment handle across products. It did not read your messages.'
    );
  });

  it('joins three families with commas and picks an before a vowel', () => {
    const card = baseCard({
      citations: [
        cit('IND-000001', 'facebook', T1, 'obs-fb-1', 'payment_handle', 'Bright.Cart'),
        cit('IND-000002', 'facebook', T2, 'obs-fb-2', 'domain', 'bills.example'),
        cit('IND-000003', 'whatsapp', T2, 'obs-w-1', 'account_ref', 'ACCT-7')
      ]
    });
    const payload = toSurfacePayload(card, NOW);
    expect(payload.privacyLine).toBe(
      'MetShield matched a payment handle, a domain and an account reference across products. It did not read your messages.'
    );
  });

  it('degrades to generic copy when a card cites nothing', () => {
    expect(privacyLineFor([])).toBe(
      'MetShield matched linked activity across products. It did not read your messages.'
    );
  });

  it.each([
    { tier: 'context', action: 'review', riskCategory: 'context' },
    { tier: 'corroborated', action: 'pause_and_verify', riskCategory: 'suspected_operation' },
    { tier: 'confirmed', action: 'restrict_surface', riskCategory: 'known_infrastructure' }
  ] as const)('tier $tier maps to $action', ({ tier, action, riskCategory }) => {
    const worldAction = toWorldAction(baseCard({ tier }), [
      makeStoredObs('obs-fb-1', 'WEVT-ABC-123'),
      makeStoredObs('obs-fb-2', 'WEVT-DEF-456')
    ]);
    expect(worldAction.action).toBe(action);
    expect(worldAction.action).not.toBe('observe');
    expect(worldAction.riskCategory).toBe(riskCategory);
  });

  it('echoes the latest cited observation’s verbatim externalRef', () => {
    const worldAction = toWorldAction(baseCard(), [
      makeStoredObs('obs-fb-1', 'WEVT-ABC-123'),
      makeStoredObs('obs-fb-2', 'WEVT-DEF-456')
    ]);
    expect(worldAction.eventRef).toBe('WEVT-DEF-456');
    expect(worldAction.eventRef).toMatch(/^WEVT-[A-Z0-9-]{1,20}$/);
    expect(worldAction.eventRef).not.toBe('CARD-000001');
    expect(worldAction.reason).toBe(`${HEADLINE} ${BODY}`);
    expect(worldAction.title).toBe(HEADLINE);
  });

  it('throws a coded error when the latest observation has no externalRef', () => {
    const obs = [makeStoredObs('obs-fb-1', 'WEVT-ABC-123'), makeStoredObs('obs-fb-2')];
    expect(() => toWorldAction(baseCard(), obs)).toThrowError(EmitError);
    try {
      toWorldAction(baseCard(), obs);
      expect.unreachable();
    } catch (err) {
      expect((err as EmitError).code).toBe('missing_external_ref');
    }
  });

  it('throws a coded error when the cited observation is unknown', () => {
    expect(() => toWorldAction(baseCard(), [])).toThrowError(EmitError);
    try {
      toWorldAction(baseCard(), []);
      expect.unreachable();
    } catch (err) {
      expect((err as EmitError).code).toBe('unknown_observation');
    }
  });

  it('puts the word scam in no payload field', () => {
    for (const card of [baseCard(), feedCard()]) {
      const payload = toSurfacePayload(card, NOW);
      for (const text of stringsOf(payload)) {
        expect(hasStandaloneScam(text), text).toBe(false);
      }
    }
  });

  it('builds the full surface payload', () => {
    expect(toSurfacePayload(baseCard(), NOW)).toEqual({
      id: 'CARD-000001',
      tier: 'corroborated',
      severity: 'caution',
      headline: HEADLINE,
      body: BODY,
      safeAction: 'leave_and_report',
      privacyLine: 'MetShield matched a domain across products. It did not read your messages.',
      evidenceBasis: 'observed',
      attribution: null,
      citations: [
        { family: 'domain', display: 'bills.example', surface: 'facebook', ageMinutes: 12960 },
        { family: 'domain', display: 'verify.example', surface: 'facebook', ageMinutes: 11520 }
      ],
      dismissible: true,
      expiresAt: '2026-06-13T12:00:00.000Z'
    });
  });

  it('truncates reason to 400 and title to 200 characters', () => {
    const card = baseCard({ headline: 'h'.repeat(250), body: 'b'.repeat(500) });
    const worldAction = toWorldAction(card, [
      makeStoredObs('obs-fb-1', 'WEVT-ABC-123'),
      makeStoredObs('obs-fb-2', 'WEVT-DEF-456')
    ]);
    expect(worldAction.reason).toHaveLength(400);
    expect(worldAction.title).toHaveLength(200);
    expect(worldAction.title).toBe('h'.repeat(200));
  });
});
