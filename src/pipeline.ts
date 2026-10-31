import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Indicator, Observation, ObservationSource, ObservationSurface } from './contract.js';
import { classifySubmissionValue } from './connectors/submit.js';
import { Store } from './store.js';
import type { StoredIndicator, StoredObservation } from './store.js';
import { clusterIsEligibleForCard } from './correlate.js';
import type { Cluster } from './correlate.js';
import { buildCard } from './cards.js';
import type { Card, FeedAttribution, ProposeFn } from './cards.js';
import type { Proposal } from './models/muse.js';
import { normalizeIndicator, routeWorldIndicator } from './normalize.js';
import { proposeCard } from './models/muse.js';

// Product pipeline (P8): one Store, one card list, one metrics block. Feed and
// world connectors call ingest(); the submission routes call submitLink() and
// (P9) submitCreative(). Only submissions build cards in this phase: ingest()
// records evidence and returns, so both poll loops stay model-free, and card
// building for ingested clusters is a P12 harness batch over getClusters().
//
// design notes enforced here:
// - ingest() is idempotent per observation id: a redelivery is a no-op that
//   touches neither the store nor the metrics, so reader dedupe caps can
//   evict without corrupting the run.
// - One card per cluster: a resubmission returns the existing card rather
//   than building again. Tier upgrades on new evidence are out of scope.
// - Decline reasons surface via readback: every buildCard null path writes a
//   declined record, so the pipeline reads the latest one back for the
//   submitter instead of widening buildCard's return type.

export interface PipelineOptions {
  root: string;
  runId: string;
  now?: () => number;
  propose?: ProposeFn;
}

export interface IngestResult {
  accepted: boolean;
  duplicate: boolean;
  joinedClusters: string[];
}

export interface SubmissionResult {
  card: Card | null;
  declineReason: string | null;
  observationId: string | null;
}

export interface PipelineMetrics {
  observations: {
    total: number;
    synthetic: number;
    bySource: Record<ObservationSource, number>;
  };
  clusters: number;
  cards: number;
  byTier: Record<Card['tier'], number>;
  eligibleEvents: number;
  silentByReason: Record<string, number>;
  demotions: number;
  wouldHaveBeenTier: Record<Card['tier'], number>;
  modelCalls: number;
  modelMs: number;
  costEstimateUsd: number;
}

// Contributor-tier meter (§4.2): $0.10 per million input tokens, $0.20 per
// million output. Exported so tests assert against the same constants the
// meter uses — a hard-coded total would prove nothing.
export const USD_PER_MTOK_INPUT = 0.1;
export const USD_PER_MTOK_OUTPUT = 0.2;

export interface CardsPage {
  cards: Card[];
  nextCursor: string | null;
}

export class Pipeline {
  private readonly store: Store;
  private readonly runDir: string;
  private readonly now: () => number;
  private readonly propose: ProposeFn;
  private readonly feedRecords = new Map<string, FeedAttribution>();
  private readonly cards: Card[] = [];
  private readonly cardByCluster = new Map<string, string>();
  private readonly metrics: Omit<PipelineMetrics, 'costEstimateUsd'> = {
    observations: { total: 0, synthetic: 0, bySource: { world: 0, public_feed: 0, submission: 0 } },
    clusters: 0,
    cards: 0,
    byTier: { context: 0, corroborated: 0, confirmed: 0 },
    eligibleEvents: 0,
    silentByReason: {},
    demotions: 0,
    wouldHaveBeenTier: { context: 0, corroborated: 0, confirmed: 0 },
    modelCalls: 0,
    modelMs: 0
  };
  private modelInputTokens = 0;
  private modelOutputTokens = 0;
  private readonly proposals = new Map<string, Proposal>();
  private subSeq = 0;

  constructor(opts: PipelineOptions) {
    this.runDir = path.join(opts.root, opts.runId);
    this.store = new Store(opts.runId, { root: opts.root, now: opts.now });
    this.now = opts.now ?? Date.now;
    this.propose =
      opts.propose ?? ((cluster: Cluster, indicators: StoredIndicator[]) => proposeCard(cluster, { indicators }));
  }

  ingest(input: unknown, feedMeta?: FeedAttribution): IngestResult {
    const id =
      typeof input === 'object' && input !== null && typeof (input as { id?: unknown }).id === 'string'
        ? (input as { id: string }).id
        : null;
    if (id === null) return { accepted: false, duplicate: false, joinedClusters: [] };
    if (this.store.getObservation(id) !== undefined) {
      return { accepted: true, duplicate: true, joinedClusters: [] };
    }
    const result = this.store.record(input);
    if (!result.accepted) return { accepted: false, duplicate: false, joinedClusters: [] };
    if (feedMeta !== undefined) this.feedRecords.set(id, feedMeta);
    const obs = input as Observation;
    this.metrics.observations.total += 1;
    if (obs.synthetic) this.metrics.observations.synthetic += 1;
    this.metrics.observations.bySource[obs.source] += 1;
    this.metrics.clusters = this.store.getClusters().length;
    return { accepted: true, duplicate: false, joinedClusters: result.joinedClusters };
  }

  async submitLink(value: string, surface: ObservationSurface): Promise<SubmissionResult> {
    const trimmed = value.trim();
    if (trimmed.length === 0) return { card: null, declineReason: 'unparseable_value', observationId: null };
    const kind = classifySubmissionValue(trimmed);
    const routed = routeWorldIndicator(kind, trimmed);
    let parseable = routed.indicators.length > 0;
    for (const pair of routed.indicators) {
      if ('rejected' in normalizeIndicator(pair)) parseable = false;
    }
    if (!parseable) return { card: null, declineReason: 'unparseable_value', observationId: null };
    return this.finishSubmission(this.mintSubmission('link', [{ kind, value: trimmed }]), surface);
  }

  async submitCreative(indicators: Indicator[], surface: ObservationSurface): Promise<SubmissionResult> {
    // No parseability gate: the file hash always normalises, and §8.4
    // requires the observation even when extraction found nothing.
    return this.finishSubmission(this.mintSubmission('creative', indicators), surface);
  }

  private mintSubmission(eventKind: 'link' | 'creative', indicators: Indicator[]): Observation {
    this.subSeq += 1;
    const id = `sub-${String(this.subSeq).padStart(6, '0')}`;
    return {
      id,
      source: 'submission',
      observedAt: new Date(this.now()).toISOString(),
      surface: 'user_submission',
      eventKind,
      actorRef: randomUUID(),
      subjectRef: null,
      threadRef: null,
      indicators,
      claimCodes: [],
      consent: 'user_submitted',
      synthetic: false
    };
  }

  private async finishSubmission(
    observation: Observation,
    surface: ObservationSurface
  ): Promise<SubmissionResult> {
    const recorded = this.ingest(observation);
    if (!recorded.accepted) {
      return { card: null, declineReason: 'rejected_observation', observationId: observation.id };
    }
    // Every recorded submission is an eligible event; rejections never enter
    // the pipeline, so they count in neither eligible nor silent.
    this.metrics.eligibleEvents += 1;
    for (const clusterId of recorded.joinedClusters) {
      const existingId = this.cardByCluster.get(clusterId);
      if (existingId !== undefined) {
        const existing = this.cards.find((c) => c.id === existingId);
        if (existing !== undefined) return { card: existing, declineReason: null, observationId: observation.id };
      }
    }
    const clusters = this.store.getClusters();
    for (const clusterId of recorded.joinedClusters) {
      const cluster = clusters.find((c) => c.id === clusterId);
      if (cluster === undefined || !clusterIsEligibleForCard(cluster)) continue;
      const card = await this.buildForCluster(cluster, surface);
      if (card !== null) return { card, declineReason: null, observationId: observation.id };
    }
    const reason = this.lastDeclineReason(recorded.joinedClusters) ?? 'ineligible_cluster';
    this.metrics.silentByReason[reason] = (this.metrics.silentByReason[reason] ?? 0) + 1;
    return { card: null, declineReason: reason, observationId: observation.id };
  }

  getRunDir(): string {
    return this.runDir;
  }

  getCards(): Card[] {
    return [...this.cards].reverse();
  }

  getCard(id: string): Card | undefined {
    return this.cards.find((c) => c.id === id);
  }

  getObservation(id: string): StoredObservation | undefined {
    return this.store.getObservation(id);
  }

  getIndicatorById(id: string): StoredIndicator | undefined {
    return this.store.getIndicatorById(id);
  }

  getMetrics(): PipelineMetrics {
    return {
      observations: {
        total: this.metrics.observations.total,
        synthetic: this.metrics.observations.synthetic,
        bySource: { ...this.metrics.observations.bySource }
      },
      clusters: this.metrics.clusters,
      cards: this.metrics.cards,
      byTier: { ...this.metrics.byTier },
      eligibleEvents: this.metrics.eligibleEvents,
      silentByReason: { ...this.metrics.silentByReason },
      demotions: this.metrics.demotions,
      wouldHaveBeenTier: { ...this.metrics.wouldHaveBeenTier },
      modelCalls: this.metrics.modelCalls,
      modelMs: this.metrics.modelMs,
      costEstimateUsd:
        (this.modelInputTokens / 1_000_000) * USD_PER_MTOK_INPUT +
        (this.modelOutputTokens / 1_000_000) * USD_PER_MTOK_OUTPUT
    };
  }

  getClusters(): Cluster[] {
    return this.store.getClusters();
  }

  getCardsPage(limit: number, cursor?: string): CardsPage {
    const all = this.getCards();
    let start = 0;
    if (cursor !== undefined) {
      const index = all.findIndex((card) => card.id === cursor);
      // The route rejects unknown cursors with a 404; reaching here means a
      // card vanished between the check and the read, and cards only append.
      if (index === -1) throw new Error(`unknown cards cursor ${cursor}`);
      start = index + 1;
    }
    const slice = all.slice(start, start + limit);
    const end = start + slice.length;
    return { cards: slice, nextCursor: end < all.length ? (slice[slice.length - 1]?.id ?? null) : null };
  }

  getProposal(cardId: string): Proposal | undefined {
    return this.proposals.get(cardId);
  }

  private async buildForCluster(cluster: Cluster, cardSurface: ObservationSurface): Promise<Card | null> {
    // Present-only evidence: an indicator the TTL sweeper has reaped is
    // dropped from the proposal rather than crashing it (proposeCard throws
    // on a missing id); resolution degrades the same way for observations.
    const indicators: StoredIndicator[] = [];
    for (const id of cluster.indicatorIds) {
      const stored = this.store.getIndicatorById(id);
      if (stored !== undefined) indicators.push(stored);
    }
    const observations: StoredObservation[] = [];
    for (const id of cluster.observationIds) {
      const stored = this.store.getObservation(id);
      if (stored !== undefined) observations.push(stored);
    }
    const card = await buildCard(cluster, {
      indicators,
      observations,
      cardSurface,
      runDir: this.runDir,
      nowMs: this.now(),
      feedRecords: this.feedRecords,
      propose: this.propose,
      onBuild: (report) => {
        this.metrics.modelCalls += 1;
        this.metrics.modelMs += report.ms;
        this.modelInputTokens += report.inputTokens;
        this.modelOutputTokens += report.outputTokens;
        this.metrics.demotions += report.demotions.length;
        if (report.cardId !== null) this.proposals.set(report.cardId, report.proposal);
        // A proposed tier that did not survive: demoted on emit, or lost to
        // silence. Decline-decisions carry no tier and count nowhere.
        const proposed = report.proposal.tier;
        if (proposed !== null && report.finalTier !== proposed) {
          this.metrics.wouldHaveBeenTier[proposed] += 1;
        }
      }
    });
    if (card !== null) {
      this.cardByCluster.set(cluster.id, card.id);
      this.cards.push(card);
      this.metrics.cards += 1;
      this.metrics.byTier[card.tier] += 1;
    }
    return card;
  }

  private lastDeclineReason(clusterIds: string[]): string | null {
    const file = path.join(this.runDir, 'cards.jsonl');
    if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      let record: unknown;
      try {
        record = JSON.parse(lines[i]) as unknown;
      } catch {
        continue;
      }
      if (typeof record !== 'object' || record === null) continue;
      const entry = record as { declined?: unknown; clusterId?: unknown; reason?: unknown };
      if (entry.declined === true && typeof entry.reason === 'string' && clusterIds.includes(entry.clusterId as string)) {
        return entry.reason;
      }
    }
    return null;
  }
}
