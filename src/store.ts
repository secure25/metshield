import fs from 'node:fs';
import path from 'node:path';
import type { IndicatorFamily, Observation } from './contract.js';
import { normalizeClaimCode, normalizeIndicator, routeWorldIndicator } from './normalize.js';
import type { ClaimCode, NormalizedIndicator } from './normalize.js';
import { Correlator } from './correlate.js';
import type { Cluster } from './correlate.js';

// TTLs in days per family. Six come from the spec; page_ref, ad_ref and
// file_hash take 30 days — they carry no expiry semantics of their own.
// Exported so citation resolution can apply the same per-observation expiry.
export const TTL_DAYS: Record<IndicatorFamily, number> = {
  domain: 30,
  payment_handle: 90,
  phone: 90,
  qr_payload: 30,
  brand_mark: 180,
  page_ref: 30,
  ad_ref: 30,
  account_ref: 14,
  file_hash: 30
};

const MS_PER_DAY = 86400000;

export interface StoredIndicator {
  id: string;
  indicator: NormalizedIndicator;
  firstSeenAt: string;
  lastSeenAt: string;
  observationIds: string[];
  expiresAt: string;
}

export interface StoredObservation {
  observation: Observation;
  normalizedClaimCodes: ClaimCode[];
  acceptedAt: string;
}

export interface RecordResult {
  accepted: boolean;
  joinedClusters: string[];
}

export interface StoreOptions {
  root?: string;
  now?: () => number;
}

export function appendJsonl(dir: string, file: string, record: unknown): void {
  fs.appendFileSync(path.join(dir, file), `${JSON.stringify(record)}\n`, 'utf8');
}

const OBSERVATION_KEYS = new Set([
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
]);

function isObservationShape(input: unknown): input is Observation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const rec = input as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!OBSERVATION_KEYS.has(key)) return false;
  }
  if (
    typeof rec.id !== 'string' ||
    typeof rec.source !== 'string' ||
    typeof rec.surface !== 'string' ||
    typeof rec.eventKind !== 'string' ||
    typeof rec.actorRef !== 'string' ||
    typeof rec.consent !== 'string' ||
    typeof rec.synthetic !== 'boolean'
  ) {
    return false;
  }
  if (typeof rec.observedAt !== 'string' || Number.isNaN(Date.parse(rec.observedAt))) return false;
  if (rec.externalRef !== undefined && typeof rec.externalRef !== 'string') return false;
  if (typeof rec.subjectRef !== 'string' && rec.subjectRef !== null) return false;
  if (typeof rec.threadRef !== 'string' && rec.threadRef !== null) return false;
  const indicators: unknown = rec.indicators;
  const claimCodes: unknown = rec.claimCodes;
  if (!Array.isArray(indicators) || !Array.isArray(claimCodes)) return false;
  for (const item of indicators) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
    const entry = item as Record<string, unknown>;
    if (typeof entry.kind !== 'string' || typeof entry.value !== 'string') return false;
  }
  for (const code of claimCodes) {
    if (typeof code !== 'string') return false;
  }
  return true;
}

export class Store {
  private readonly dir: string;
  private readonly now: () => number;
  private readonly correlator = new Correlator();
  private seq = 0;
  private readonly byKey = new Map<string, StoredIndicator>();
  private readonly byId = new Map<string, StoredIndicator>();
  private readonly observations = new Map<string, StoredObservation>();

  constructor(runId: string, opts: StoreOptions = {}) {
    const root = opts.root ?? path.resolve('runs');
    this.dir = path.join(root, runId);
    fs.mkdirSync(this.dir, { recursive: true });
    this.now = opts.now ?? Date.now;
  }

  record(input: unknown): RecordResult {
    if (!isObservationShape(input)) return { accepted: false, joinedClusters: [] };
    const acceptedAt = new Date(this.now()).toISOString();
    const codes = new Set<ClaimCode>();
    for (const code of input.claimCodes) {
      const normalized = normalizeClaimCode(code);
      if (normalized !== null) codes.add(normalized);
    }
    const indexed: Array<{ id: string; family: IndicatorFamily }> = [];
    for (const item of input.indicators) {
      const routed = routeWorldIndicator(item.kind, item.value);
      for (const code of routed.claimCodes) {
        const normalized = normalizeClaimCode(code);
        if (normalized !== null) codes.add(normalized);
      }
      for (const pair of routed.indicators) {
        const result = normalizeIndicator(pair);
        if ('rejected' in result) continue;
        indexed.push({ id: this.index(result, input.id, input.observedAt), family: result.family });
      }
    }
    const joined = this.correlator.ingest({
      observationId: input.id,
      surface: input.surface,
      observedAt: input.observedAt,
      synthetic: input.synthetic,
      claimCodes: [...codes],
      indicators: indexed
    });
    this.observations.set(input.id, {
      observation: input,
      normalizedClaimCodes: [...codes],
      acceptedAt
    });
    appendJsonl(this.dir, 'observations.jsonl', {
      observation: input,
      normalizedClaimCodes: [...codes],
      acceptedAt
    });
    return { accepted: true, joinedClusters: joined };
  }

  get(family: IndicatorFamily, canonical: string): StoredIndicator | undefined {
    return this.byKey.get(`${family}:${canonical}`);
  }

  getIndicatorById(id: string): StoredIndicator | undefined {
    return this.byId.get(id);
  }

  getObservation(id: string): StoredObservation | undefined {
    return this.observations.get(id);
  }

  getClusters(): Cluster[] {
    return this.correlator.clusters();
  }

  sweepExpired(nowMs?: number): string[] {
    const now = nowMs ?? this.now();
    const expired: string[] = [];
    for (const stored of this.byKey.values()) {
      if (Date.parse(stored.expiresAt) <= now) expired.push(stored.id);
    }
    for (const id of expired) {
      const stored = this.byId.get(id);
      if (stored === undefined) continue;
      this.byKey.delete(`${stored.indicator.family}:${stored.indicator.canonical}`);
      this.byId.delete(id);
      appendJsonl(this.dir, 'indicators.jsonl', {
        event: 'expire',
        indicatorId: id,
        family: stored.indicator.family,
        canonical: stored.indicator.canonical,
        observationId: null,
        at: new Date(now).toISOString()
      });
    }
    return expired;
  }

  private index(indicator: NormalizedIndicator, observationId: string, observedAt: string): string {
    const key = `${indicator.family}:${indicator.canonical}`;
    const existing = this.byKey.get(key);
    if (existing === undefined) {
      this.seq += 1;
      const id = `IND-${String(this.seq).padStart(6, '0')}`;
      const stored: StoredIndicator = {
        id,
        indicator,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        observationIds: [observationId],
        expiresAt: new Date(Date.parse(observedAt) + TTL_DAYS[indicator.family] * MS_PER_DAY).toISOString()
      };
      this.byKey.set(key, stored);
      this.byId.set(id, stored);
      appendJsonl(this.dir, 'indicators.jsonl', {
        event: 'create',
        indicatorId: id,
        family: indicator.family,
        canonical: indicator.canonical,
        observationId,
        at: observedAt
      });
      return id;
    }
    if (!existing.observationIds.includes(observationId)) existing.observationIds.push(observationId);
    if (observedAt > existing.lastSeenAt) {
      existing.lastSeenAt = observedAt;
      existing.expiresAt = new Date(Date.parse(observedAt) + TTL_DAYS[indicator.family] * MS_PER_DAY).toISOString();
    }
    appendJsonl(this.dir, 'indicators.jsonl', {
      event: 'match',
      indicatorId: existing.id,
      family: existing.indicator.family,
      canonical: existing.indicator.canonical,
      observationId,
      at: observedAt
    });
    return existing.id;
  }
}
