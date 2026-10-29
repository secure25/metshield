import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Observation } from '../src/contract.js';

const ALLOWED = [
  'id',
  'externalRef',
  'source',
  'observedAt',
  'surface',
  'eventKind',
  'actorRef',
  'subjectRef',
  'threadRef',
  'indicators',
  'claimCodes',
  'consent',
  'synthetic'
];

const FORBIDDEN = ['truth', 'campaignId', 'label', 'score', 'raw'];

describe('contract', () => {
  it('Observation has no forbidden data keys', () => {
    const sample: Observation = {
      id: 'obs-001',
      externalRef: 'world-001',
      source: 'world',
      observedAt: '2026-01-01T00:00:00.000Z',
      surface: 'facebook',
      eventKind: 'message',
      actorRef: 'acct-001',
      subjectRef: null,
      threadRef: null,
      indicators: [],
      claimCodes: [],
      consent: 'none',
      synthetic: true
    };
    const keys = Object.keys(sample).sort();
    expect(keys).toEqual([...ALLOWED].sort());
    for (const k of FORBIDDEN) {
      expect(keys).not.toContain(k);
    }
    const contractPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../src/contract.ts'
    );
    const src = fs.readFileSync(contractPath, 'utf8');
    // The one exception is required, not forbidden: `raw?: never` makes
    // storing conversation text a compile error. Enforce its exact presence,
    // then assert no other forbidden-shaped field remains.
    expect(src).toContain('raw?: never;');
    const scrubbed = src.replace(/raw\?: never;/g, '');
    const fieldPattern = new RegExp(`\\b(${FORBIDDEN.join('|')})\\s*[:?]`);
    expect(scrubbed).not.toMatch(fieldPattern);
  });
});
