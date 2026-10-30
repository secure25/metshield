import type { IndicatorFamily, ObservationSurface } from './contract.js';
import type { Card, CardTier } from './cards.js';
import type { StoredObservation } from './store.js';

// Emission (P6): validated cards become renderable payloads. Pure functions,
// no model, no network. Two targets: a product surface payload (what P11
// previews and a real surface would render under its own warning) and the
// old lab's action shape (kept for the /v1 contract; our rebuilt world is
// read-only toward the product and implements no action endpoint).

export type Severity = 'info' | 'caution' | 'warning';

export const SEVERITY_BY_TIER: Record<CardTier, Severity> = {
  context: 'info',
  corroborated: 'caution',
  confirmed: 'warning'
};

// Only the strongest warning is non-dismissible; anything weaker must stay
// out of the user's way on demand.
export const DISMISSIBLE_BY_TIER: Record<CardTier, boolean> = {
  context: true,
  corroborated: true,
  confirmed: false
};

export type WorldActionName = 'review' | 'pause_and_verify' | 'restrict_surface';

export const ACTION_BY_TIER: Record<CardTier, WorldActionName> = {
  context: 'review',
  corroborated: 'pause_and_verify',
  confirmed: 'restrict_surface'
};

// MetShield's own risk vocabulary. The old lab's categories died with the old
// lab; these three are tier-echoing on purpose — the action carries no finer
// claim than the card's tier.
export type RiskCategory = 'context' | 'suspected_operation' | 'known_infrastructure';

export const RISK_CATEGORY_BY_TIER: Record<CardTier, RiskCategory> = {
  context: 'context',
  corroborated: 'suspected_operation',
  confirmed: 'known_infrastructure'
};

export const FAMILY_LABELS: Record<IndicatorFamily, string> = {
  domain: 'domain',
  payment_handle: 'payment handle',
  phone: 'phone',
  qr_payload: 'QR payload',
  brand_mark: 'brand mark',
  page_ref: 'page reference',
  ad_ref: 'ad reference',
  account_ref: 'account reference',
  file_hash: 'file hash'
};

export interface SurfaceCitation {
  family: IndicatorFamily;
  display: string;
  surface: ObservationSurface;
  ageMinutes: number;
}

export interface SurfacePayload {
  id: string;
  tier: CardTier;
  severity: Severity;
  headline: string;
  body: string;
  safeAction: Card['safeAction'];
  privacyLine: string;
  evidenceBasis: Card['provenance']['evidenceBasis'];
  attribution: { feedName: string; publishedAt: string } | null;
  citations: SurfaceCitation[];
  dismissible: boolean;
  expiresAt: string;
}

export interface WorldAction {
  eventRef: string;
  action: WorldActionName;
  reason: string;
  riskCategory: RiskCategory;
  title: string;
}

export type EmitErrorCode = 'missing_external_ref' | 'unknown_observation';

export class EmitError extends Error {
  readonly code: EmitErrorCode;

  constructor(code: EmitErrorCode, message: string) {
    super(message);
    this.name = 'EmitError';
    this.code = code;
  }
}

function article(label: string): string {
  return /^[aeiou]/i.test(label) ? 'an' : 'a';
}

export function privacyLineFor(families: IndicatorFamily[]): string {
  if (families.length === 0) {
    // Unreachable for validated cards (V3 guarantees citations); a render
    // path must not crash on a hand-built card, so degrade to generic copy.
    return 'MetShield matched linked activity across products. It did not read your messages.';
  }
  const phrases = families.map((family) => `${article(FAMILY_LABELS[family])} ${FAMILY_LABELS[family]}`);
  const joined =
    phrases.length === 1
      ? phrases[0]
      : phrases.length === 2
        ? `${phrases[0]} and ${phrases[1]}`
        : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
  return `MetShield matched ${joined} across products. It did not read your messages.`;
}

function citedFamilies(card: Card): IndicatorFamily[] {
  const seen = new Set<IndicatorFamily>();
  const ordered: IndicatorFamily[] = [];
  for (const citation of card.citations) {
    if (!seen.has(citation.family)) {
      seen.add(citation.family);
      ordered.push(citation.family);
    }
  }
  return ordered;
}

export function toSurfacePayload(card: Card, nowMs: number = Date.now()): SurfacePayload {
  const attribution = card.provenance.attribution;
  return {
    id: card.id,
    tier: card.tier,
    severity: SEVERITY_BY_TIER[card.tier],
    headline: card.headline,
    body: card.body,
    safeAction: card.safeAction,
    privacyLine: privacyLineFor(citedFamilies(card)),
    evidenceBasis: card.provenance.evidenceBasis,
    attribution: attribution === undefined ? null : { feedName: attribution.feedName, publishedAt: attribution.publishedAt },
    citations: card.citations.map((citation) => ({
      family: citation.family,
      display: citation.display,
      surface: citation.surface,
      ageMinutes: Math.max(0, Math.round((nowMs - Date.parse(citation.observedAt)) / 60000))
    })),
    dismissible: DISMISSIBLE_BY_TIER[card.tier],
    expiresAt: card.expiresAt
  };
}

export function toWorldAction(card: Card, observations: StoredObservation[]): WorldAction {
  if (card.citations.length === 0) {
    throw new EmitError('unknown_observation', `card ${card.id} cites nothing to act on`);
  }
  const byId = new Map(observations.map((stored) => [stored.observation.id, stored]));
  let latest = card.citations[0];
  for (const citation of card.citations) {
    if (citation.observedAt > latest.observedAt) latest = citation;
  }
  const stored = byId.get(latest.observationId);
  if (stored === undefined) {
    throw new EmitError('unknown_observation', `no observation ${latest.observationId} for card ${card.id}`);
  }
  const eventRef = stored.observation.externalRef;
  if (eventRef === undefined || eventRef.length === 0) {
    throw new EmitError('missing_external_ref', `observation ${latest.observationId} has no externalRef`);
  }
  // Verbatim pass-through: the id is echoed exactly as the source wrote it.
  // It is not validated against the old WEVT shape here — our rebuilt world
  // emits EV- ids and takes no actions back, so format policing would only
  // add a failure mode to a bridge function.
  return {
    eventRef,
    action: ACTION_BY_TIER[card.tier],
    reason: `${card.headline} ${card.body}`.slice(0, 400),
    riskCategory: RISK_CATEGORY_BY_TIER[card.tier],
    title: card.headline.slice(0, 200)
  };
}
