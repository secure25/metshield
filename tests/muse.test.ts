import { afterEach, describe, expect, it, vi } from 'vitest';
import { proposeCard } from '../src/models/muse.js';
import type { Cluster } from '../src/correlate.js';
import type { StoredIndicator } from '../src/store.js';

const FORBIDDEN_KEYS = [
  'surfaceText',
  'raw',
  'actorRef',
  'subjectRef',
  'threadRef',
  'observedAt',
  'externalRef',
  'consent',
  'synthetic',
  'displayName',
  'handle',
  'bio',
  'personId'
];

function fixtureCluster(): Cluster {
  return {
    id: 'CLU-000001',
    indicatorIds: ['IND-000001', 'IND-000002'],
    surfaces: ['facebook', 'messenger'],
    observationIds: ['obs-1', 'obs-2'],
    familyCount: 2,
    claimCodes: ['offer', 'urgency_phrase'],
    firstSeenAt: '2026-06-01T12:00:00.000Z',
    lastSeenAt: '2026-06-01T12:42:00.000Z',
    perSurfaceCounts: { facebook: 1, messenger: 1 },
    syntheticAll: true,
    tierInputs: {
      crossSurfacePairs: [['facebook', 'messenger']],
      families: ['domain', 'payment_handle'],
      hasConfirmedIndicator: false
    }
  };
}

function fixtureIndicators(): StoredIndicator[] {
  const base = {
    firstSeenAt: '2026-06-01T12:00:00.000Z',
    lastSeenAt: '2026-06-01T12:42:00.000Z',
    observationIds: ['obs-1', 'obs-2'],
    expiresAt: '2026-07-01T12:00:00.000Z'
  };
  return [
    {
      ...base,
      id: 'IND-000001',
      indicator: { family: 'domain', canonical: 'bills.example', display: 'bills.example', registrable: 'bills.example' }
    },
    {
      ...base,
      id: 'IND-000002',
      indicator: { family: 'payment_handle', canonical: 'bright.cart', display: 'Bright.Cart', variant: 'Bright.Cart' }
    }
  ];
}

function stubOkFetch(body: unknown): void {
  const envelope = {
    choices: [{ message: { content: JSON.stringify(body) } }],
    usage: { prompt_tokens: 100, completion_tokens: 20 }
  };
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(envelope))
    } as unknown as Response)
  );
  vi.stubGlobal('fetch', fetchMock);
}

describe('muse', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubEnv(): void {
    vi.stubEnv('METASHIELD_BASE_URL', 'https://api.test/v1');
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
  }

  it('sends only cluster evidence, never observation fields', async () => {
    stubEnv();
    let captured = '';
    const fetchMock = vi.fn((url: unknown, init: { body?: unknown }) => {
      captured = String(init.body);
      const envelope = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                decision: 'decline',
                tier: null,
                headline: null,
                body: null,
                safeAction: null,
                citations: [],
                declineReason: 'insufficient_cross_surface',
                confidence: 0.9
              })
            }
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      };
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(envelope))
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await proposeCard(fixtureCluster(), { indicators: fixtureIndicators() });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(captured) as { messages: Array<{ content: string }> };
    const text = JSON.stringify(parsed.messages);
    for (const key of FORBIDDEN_KEYS) {
      expect(text, `prompt leaks ${key}`).not.toContain(`"${key}"`);
    }
    expect(text).toContain('IND-000001');
    expect(text).toContain('bills.example');
    expect(text).toContain('facebook: 1');
    expect(text).toContain('42');
    expect(text).toContain('offer');
  });

  it('parses a decline response as a valid proposal', async () => {
    stubEnv();
    stubOkFetch({
      decision: 'decline',
      tier: null,
      headline: null,
      body: null,
      safeAction: null,
      citations: [],
      declineReason: 'single_family',
      confidence: 0.7
    });
    const result = await proposeCard(fixtureCluster(), { indicators: fixtureIndicators() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.decision).toBe('decline');
    expect(result.data.declineReason).toBe('single_family');
  });

  it('passes transport failures through instead of throwing', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('') } as unknown as Response))
    );
    const result = await proposeCard(fixtureCluster(), { indicators: fixtureIndicators() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('http_5xx');
  });

  it('uses the default model, temperature and schema name', async () => {
    stubEnv();
    let captured = '';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown, init: { body?: unknown }) => {
        captured = String(init.body);
        const envelope = {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: 'decline',
                  tier: null,
                  headline: null,
                  body: null,
                  safeAction: null,
                  citations: [],
                  declineReason: 'benign_explanation',
                  confidence: 0.5
                })
              }
            }
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 }
        };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(envelope))
        } as unknown as Response);
      })
    );
    await proposeCard(fixtureCluster(), { indicators: fixtureIndicators() });
    const body = JSON.parse(captured) as {
      model: string;
      temperature: number;
      response_format: { type: string; json_schema: { name: string } };
    };
    expect(body.model).toBe('muse-spark-1.3');
    expect(body.temperature).toBe(0.2);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.name).toBe('card_proposal');
  });
});
