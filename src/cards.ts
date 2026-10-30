import type { IndicatorFamily, ObservationSource, ObservationSurface } from './contract.js';
import { clusterIsEligibleForCard } from './correlate.js';
import type { Cluster } from './correlate.js';
import { TTL_DAYS, appendJsonl } from './store.js';
import type { StoredIndicator, StoredObservation } from './store.js';
import type { CompletionResult } from './models/client.js';
import { MUSE_DEFAULT_MODEL, proposeCard } from './models/muse.js';
import type { Proposal } from './models/muse.js';
import { CARD_PROMPT_VERSION } from './models/prompts/card.v1.js';

// Card generation (P4): resolve the model's bare indicator ids against cluster
// evidence (§5.3), build the candidate from the resolved citations only, attach
// provenance, and hand the result to the validator.
//
// P5 owns validate.ts. Until it lands, the validator is an injected hook: pass
// `validate` in BuildCardDeps to enforce real rules; the default is a
// passthrough returning the candidate unchanged. The ValidateFn signature here
// is the contract P5's validateCard must satisfy: it returns additional drops
// only, and buildCard concatenates them after the resolver's own V1/V2 drops.

export type CardTier = 'context' | 'corroborated' | 'confirmed';
export type CardSafeAction = 'do_not_pay' | 'do_not_share_code' | 'leave_and_report' | 'verify_in_app';
export type EvidenceBasis = 'observed' | 'source_reported';
export type AssertedClaim = 'listing' | 'live_phishing' | 'takedown';

export interface FeedAttribution {
  feedName: string;
  publishedAt: string;
  assertedClaim: AssertedClaim;
}

export interface Citation {
  indicatorId: string;
  family: IndicatorFamily;
  display: string;
  surface: ObservationSurface;
  observedAt: string;
  observationId: string;
}

export type CitationRejectionCode = 'citation_unknown_indicator' | 'citation_not_cross_surface';

export interface RejectedCitation {
  indicatorId: string;
  code: CitationRejectionCode;
}

export interface DroppedClaim {
  rule: string;
  text: string;
  reason: string;
}

export interface CardProvenance {
  sources: ObservationSource[];
  synthetic: boolean;
  evidenceBasis: EvidenceBasis;
  attribution?: FeedAttribution;
  proposedTier: string | null;
  dropped: DroppedClaim[];
  model: string;
  promptVersion: string;
}

export interface Card {
  id: string;
  clusterId: string;
  tier: CardTier;
  surface: ObservationSurface;
  threadRef?: string;
  headline: string;
  body: string;
  safeAction: CardSafeAction;
  citations: Citation[];
  provenance: CardProvenance;
  createdAt: string;
  expiresAt: string;
}

export interface DeclinedRecord {
  event: 'decline';
  declined: true;
  clusterId: string;
  reason: string;
  proposedTier: string | null;
  rejected: RejectedCitation[];
  dropped: DroppedClaim[];
  at: string;
}

export interface CitationLookups {
  indicatorsById: ReadonlyMap<string, StoredIndicator>;
  observationsById: ReadonlyMap<string, StoredObservation>;
}

export interface ResolveResult {
  citations: Citation[];
  rejected: RejectedCitation[];
}

const MS_PER_DAY = 86400000;

// Card expiry. The spec fixes evidence windows but no card TTL; 72h matches
// the context tier's evidence-age window.
const CARD_TTL_HOURS = 72;

// Product surfaces in this workspace's vocabulary: the three world products.
// Anything else (public_feed, user_submission) is not a product observation,
// so a card citing only those is source_reported.
function isProductSurface(surface: ObservationSurface): boolean {
  return surface === 'facebook' || surface === 'messenger' || surface === 'whatsapp';
}

export function resolveCitations(
  cluster: Cluster,
  citedIds: string[],
  cardSurface: ObservationSurface,
  nowMs: number,
  lookups: CitationLookups
): ResolveResult {
  const citations: Citation[] = [];
  const rejected: RejectedCitation[] = [];
  const seen = new Set<string>();
  const inCluster = new Set<string>(cluster.indicatorIds);
  const clusterObs = new Set<string>(cluster.observationIds);
  for (const id of citedIds) {
    // One citation per indicator: a repeated id resolves once, so citing the
    // same indicator twice cannot manufacture a second citation.
    if (seen.has(id)) continue;
    seen.add(id);
    const stored = lookups.indicatorsById.get(id);
    if (stored === undefined || !inCluster.has(id)) {
      rejected.push({ indicatorId: id, code: 'citation_unknown_indicator' });
      continue;
    }
    const ttlMs = TTL_DAYS[stored.indicator.family] * MS_PER_DAY;
    const candidates: StoredObservation[] = [];
    for (const obsId of stored.observationIds) {
      if (!clusterObs.has(obsId)) continue;
      const obs = lookups.observationsById.get(obsId);
      if (obs === undefined) continue;
      if (obs.observation.surface === cardSurface) continue;
      // Per-observation expiry: an observation older than its family's TTL
      // stops being citable, so an expired earliest record is skipped rather
      // than cited.
      if (Date.parse(obs.observation.observedAt) + ttlMs <= nowMs) continue;
      candidates.push(obs);
    }
    if (candidates.length === 0) {
      rejected.push({ indicatorId: id, code: 'citation_not_cross_surface' });
      continue;
    }
    candidates.sort((a, b) => {
      if (a.observation.observedAt < b.observation.observedAt) return -1;
      if (a.observation.observedAt > b.observation.observedAt) return 1;
      return a.observation.id < b.observation.id ? -1 : 1;
    });
    const picked = candidates[0];
    // Display is the stored variant where the family keeps one
    // (payment_handle preserves the observed spelling in `display`) and the
    // canonical value everywhere else. Per-observation spellings are not
    // retained by the store, so every citation of one indicator shows the
    // same display; that is a documented limitation, not a second query.
    citations.push({
      indicatorId: id,
      family: stored.indicator.family,
      display: stored.indicator.display,
      surface: picked.observation.surface,
      observedAt: picked.observation.observedAt,
      observationId: picked.observation.id
    });
  }
  return { citations, rejected };
}

export interface ValidationResult {
  card: Card | null;
  dropped: DroppedClaim[];
  finalTier: CardTier | null;
  demotions: string[];
}

export type ValidateFn = (candidate: Card, cluster: Cluster, nowMs: number) => ValidationResult;

export type ProposeFn = (cluster: Cluster, indicators: StoredIndicator[]) => Promise<CompletionResult<Proposal>>;

export interface BuildCardDeps {
  indicators: StoredIndicator[];
  observations: StoredObservation[];
  cardSurface: ObservationSurface;
  runDir: string;
  nowMs?: number;
  model?: string;
  threadRef?: string;
  feedRecords?: ReadonlyMap<string, FeedAttribution>;
  propose?: ProposeFn;
  validate?: ValidateFn;
}

let cardSeq = 0;

function nextCardId(): string {
  cardSeq += 1;
  return `CARD-${String(cardSeq).padStart(6, '0')}`;
}

function passthroughValidator(candidate: Card, _cluster: Cluster, _nowMs: number): ValidationResult {
  return { card: candidate, dropped: [], finalTier: candidate.tier, demotions: [] };
}

function writeDeclined(
  runDir: string,
  clusterId: string,
  reason: string,
  proposedTier: string | null,
  rejected: RejectedCitation[],
  dropped: DroppedClaim[],
  at: string
): null {
  const record: DeclinedRecord = {
    event: 'decline',
    declined: true,
    clusterId,
    reason,
    proposedTier,
    rejected,
    dropped,
    at
  };
  appendJsonl(runDir, 'cards.jsonl', record);
  return null;
}

export async function buildCard(cluster: Cluster, deps: BuildCardDeps): Promise<Card | null> {
  const nowMs = deps.nowMs ?? Date.now();
  const at = new Date(nowMs).toISOString();
  const indicatorsById = new Map(deps.indicators.map((stored) => [stored.id, stored]));
  const observationsById = new Map(deps.observations.map((stored) => [stored.observation.id, stored]));

  if (!clusterIsEligibleForCard(cluster)) {
    return writeDeclined(deps.runDir, cluster.id, 'ineligible_cluster', null, [], [], at);
  }

  const propose: ProposeFn =
    deps.propose ?? ((c: Cluster, inds: StoredIndicator[]) => proposeCard(c, { indicators: inds, model: deps.model }));
  const result = await propose(cluster, deps.indicators);
  if (!result.ok) {
    return writeDeclined(deps.runDir, cluster.id, result.code, null, [], [], at);
  }
  const proposal = result.data;
  if (proposal.decision === 'decline') {
    return writeDeclined(deps.runDir, cluster.id, proposal.declineReason ?? 'decline', null, [], [], at);
  }
  if (proposal.tier === null || proposal.headline === null || proposal.body === null || proposal.safeAction === null) {
    return writeDeclined(deps.runDir, cluster.id, 'invalid_proposal', proposal.tier, [], [], at);
  }
  const tier = proposal.tier;
  const headline = proposal.headline;
  const body = proposal.body;
  const safeAction = proposal.safeAction;

  const resolved = resolveCitations(cluster, proposal.citations, deps.cardSurface, nowMs, {
    indicatorsById,
    observationsById
  });
  if (resolved.citations.length === 0) {
    return writeDeclined(deps.runDir, cluster.id, 'no_resolvable_citations', tier, resolved.rejected, [], at);
  }

  const citedObs: StoredObservation[] = [];
  for (const citation of resolved.citations) {
    const obs = observationsById.get(citation.observationId);
    // Resolution guarantees every cited observation exists; a miss means the
    // caller's lookups disagree with the cluster, which is a bug, not a decline.
    if (obs === undefined) throw new Error(`citation lookup missed for cluster ${cluster.id}`);
    citedObs.push(obs);
  }

  // Sources and synthetic aggregate over the whole cluster — the evidence
  // base the model considered — not just the cited observations. The
  // submission observation a feed-path card is built for sits on the card's
  // own surface, so it is never cited, yet the card must still own it as a
  // source. Evidence basis below stays cited-based per §5.1's explicit
  // "cited observation" language.
  const clusterSources = new Set<ObservationSource>();
  let synthetic = true;
  for (const obsId of cluster.observationIds) {
    const obs = observationsById.get(obsId);
    if (obs === undefined) throw new Error(`missing observation ${obsId} for cluster ${cluster.id}`);
    clusterSources.add(obs.observation.source);
    if (!obs.observation.synthetic) synthetic = false;
  }
  const sources = [...clusterSources].sort();
  const evidenceBasis: EvidenceBasis = citedObs.some((obs) => isProductSurface(obs.observation.surface))
    ? 'observed'
    : 'source_reported';
  let attribution: FeedAttribution | undefined;
  if (evidenceBasis === 'source_reported' && deps.feedRecords !== undefined) {
    for (const citation of resolved.citations) {
      const found = deps.feedRecords.get(citation.observationId);
      if (found !== undefined) {
        attribution = found;
        break;
      }
    }
  }
  // Resolver rejections are V1/V2 failures detected before the validator runs
  // (§5.3 names the rules explicitly), so on the emit path they merge into
  // provenance.dropped rather than vanishing from cards.jsonl.
  const resolverDropped: DroppedClaim[] = resolved.rejected.map((entry) => ({
    rule: entry.code === 'citation_unknown_indicator' ? 'V1' : 'V2',
    text: entry.indicatorId,
    reason: entry.code
  }));
  const candidate: Card = {
    id: nextCardId(),
    clusterId: cluster.id,
    tier,
    surface: deps.cardSurface,
    ...(deps.threadRef === undefined ? {} : { threadRef: deps.threadRef }),
    headline,
    body,
    safeAction,
    citations: resolved.citations,
    provenance: {
      sources,
      synthetic,
      evidenceBasis,
      ...(attribution === undefined ? {} : { attribution }),
      proposedTier: tier,
      dropped: resolverDropped,
      model: deps.model ?? MUSE_DEFAULT_MODEL,
      promptVersion: CARD_PROMPT_VERSION
    },
    createdAt: at,
    expiresAt: new Date(nowMs + CARD_TTL_HOURS * 3600000).toISOString()
  };

  const validate = deps.validate ?? passthroughValidator;
  const verdict = validate(candidate, cluster, nowMs);
  const dropped = [...resolverDropped, ...verdict.dropped];
  if (verdict.card === null) {
    return writeDeclined(deps.runDir, cluster.id, 'validator_rejected', tier, resolved.rejected, dropped, at);
  }
  const finalCard: Card = {
    ...verdict.card,
    provenance: { ...verdict.card.provenance, dropped }
  };
  appendJsonl(deps.runDir, 'cards.jsonl', finalCard);
  return finalCard;
}
