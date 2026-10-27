import { CANARY_HANDLE, CANARY_SLUG } from './population.js';
import type { Observation } from '../contract.js';
import type { WorldState } from './types.js';

const FORBIDDEN_KEYS = ['truth', 'campaignId', 'label', 'score', 'raw'];
const MARKER_RE = /^(CMP-\d+|OP-\d+)$/;

function stringsOf(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) stringsOf(v, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) stringsOf(v, out);
  }
}

// Metering gate for the public feed: counts what went out and scans every
// record for the four leak families. Each category counts observations with
// at least one hit. All four violation counters must stay zero forever;
// any nonzero value is a projection bug, caught here instead of in review.
export function scanAndCount(state: WorldState, observations: Observation[]): void {
  const integ = state.integrity;
  integ.observationsSent += observations.length;
  if (observations.length === 0) return;
  const texts = new Set(state.events.map((e) => e.surfaceText));
  for (const obs of observations) {
    if (Object.keys(obs).some((k) => FORBIDDEN_KEYS.includes(k))) {
      integ.truthLabelsSentToDetector += 1;
    }
    const values: string[] = [];
    stringsOf(obs, values);
    let raw = false;
    let marker = false;
    let canary = false;
    for (const v of values) {
      if (!raw && texts.has(v)) raw = true;
      if (!marker && MARKER_RE.test(v)) marker = true;
      if (!canary && (v.includes(CANARY_HANDLE) || v.includes(CANARY_SLUG))) canary = true;
      if (raw && marker && canary) break;
    }
    if (raw) integ.rawTextInObservations += 1;
    if (marker) integ.campaignMarkersInObservations += 1;
    if (canary) integ.canaryLeaks += 1;
  }
}
