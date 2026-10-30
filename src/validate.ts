import type { ObservationSurface } from './contract.js';
import type { Card, CardTier, Citation, DroppedClaim, ValidationResult } from './cards.js';
import type { Cluster } from './correlate.js';
import { matchSentence } from './copy/card.v1.js';
import { GUILT_TOKENS, URGENCY_TOKENS } from './validate.lexicon.js';

// The validator (P5): deterministic tripwire between the model's proposal and
// anything renderable. Pure functions, no model, no network, no clock beyond
// the injected nowMs. Rule order in validateCard is load-bearing: structural
// rejections (V6/V7) first, then V11 so a source_reported failure rejects
// alone, then citation filtering (V1/V2/V3), then sentence rules
// (V4a/V4b/V5/V8, first failure wins per sentence), then V9 demotion, then
// V10 survival.
//
// Two splits are deliberate and tested:
// - V4b checks slot shape and provenance class (is this fill drawn from the
//   right evidence?); V8 checks numeric exactness (does this number equal the
//   recomputed value?). A wrong number fails under V8 alone, which is the
//   only way the "invented amount" case can name its rule.
// - Rejection attribution travels in `dropped` as {rule: 'V6'|'V7'|'V11', …}
//   (and V3/V10 likewise), so every rule is observable without widening the
//   ValidationResult shape P4's buildCard consumes. Per that contract,
//   result.dropped carries only the validator's own new drops; the returned
//   card's provenance.dropped preserves the candidate's incoming drops first.
//
// What the validator cannot see: it takes (candidate, cluster) only, so
// citation display strings are trusted as resolveCitations wrote them. That
// is safe inside the pipeline — the model never supplies citation fields —
// but a hostile caller constructing a candidate by hand could lie in a
// display. Counts come from cluster aggregates (perSurfaceCounts and id-list
// lengths), which the correlator never expires; per-indicator qualifying
// counts per §5.3 would need the evidence maps and are buildCard's side.

export const CARD_TIERS = ['context', 'corroborated', 'confirmed'] as const;
export const CARD_SAFE_ACTIONS = ['do_not_pay', 'do_not_share_code', 'leave_and_report', 'verify_in_app'] as const;
export const DECLINE_REASON_CODES = [
  'insufficient_cross_surface',
  'single_family',
  'ambiguous_reuse',
  'benign_explanation'
] as const;
export const ASSERTED_CLAIM_CODES = ['listing', 'live_phishing', 'takedown'] as const;

export interface SlotContext {
  candidate: Card;
  cluster: Cluster;
  nowMs: number;
}

const AGO_SHAPE = /^\d+ (minutes?|hours?|days?) ago$/;
const COUNT_SHAPE = /^\d+$/;

export function renderAgo(nowMs: number, iso: string): string {
  const minutes = Math.max(1, Math.floor((nowMs - Date.parse(iso)) / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function splitSentences(body: string): string[] {
  const out: string[] = [];
  const re = /[^.!?]+[.!?]+/g;
  let match: RegExpExecArray | null;
  let last = 0;
  while ((match = re.exec(body)) !== null) {
    out.push(match[0].trim());
    last = match.index + match[0].length;
  }
  // Trailing text without a terminator is still a sentence — it must fail
  // V4a with an entry, never vanish silently.
  const rest = body.slice(last).trim();
  if (rest.length > 0) out.push(rest);
  return out.filter((sentence) => sentence.length > 0);
}

export function demoteTier(tier: CardTier): CardTier | null {
  if (tier === 'confirmed') return 'corroborated';
  if (tier === 'corroborated') return 'context';
  return null;
}

export function checkV6(candidate: Card): DroppedClaim | null {
  if (!CARD_TIERS.includes(candidate.tier)) {
    return { rule: 'V6', text: String(candidate.tier), reason: 'bad_tier' };
  }
  if (!CARD_SAFE_ACTIONS.includes(candidate.safeAction)) {
    return { rule: 'V6', text: String(candidate.safeAction), reason: 'bad_safe_action' };
  }
  return null;
}

export function checkV7(candidate: Card): DroppedClaim | null {
  if (candidate.headline.length > 90) return { rule: 'V7', text: 'headline', reason: 'headline_too_long' };
  if (candidate.body.length > 320) return { rule: 'V7', text: 'body', reason: 'body_too_long' };
  return null;
}

export function checkV11(candidate: Card, nowMs: number): DroppedClaim | null {
  if (candidate.provenance.evidenceBasis !== 'source_reported') return null;
  const attribution = candidate.provenance.attribution;
  if (
    attribution === undefined ||
    attribution.feedName.length === 0 ||
    attribution.publishedAt.length === 0 ||
    !ASSERTED_CLAIM_CODES.includes(attribution.assertedClaim)
  ) {
    return { rule: 'V11', text: 'attribution', reason: 'missing_or_invalid_attribution' };
  }
  const sentences = splitSentences(candidate.body);
  let feedSlotsOk = false;
  for (const sentence of sentences) {
    const matched = matchSentence(sentence, 'body');
    if (matched === null || matched.templateId !== 'F') continue;
    const feedName = matched.fills['feedName'];
    const publishedAgo = matched.fills['publishedAgo'];
    if (feedName === undefined || publishedAgo === undefined) continue;
    if (feedName === attribution.feedName && publishedAgo === renderAgo(nowMs, attribution.publishedAt)) {
      feedSlotsOk = true;
      break;
    }
  }
  // No F sentence carrying resolved feed slots: the card claims a
  // source-reported match without naming its source in the copy. This also
  // encodes the template-F requirement — E-only copy has no feed slots.
  if (!feedSlotsOk) return { rule: 'V11', text: 'feed_slots', reason: 'unresolved_feed_slots' };
  const headlineMatch = matchSentence(candidate.headline, 'headline');
  if (headlineMatch !== null && headlineMatch.templateId !== 'E' && headlineMatch.templateId !== 'F') {
    return { rule: 'V11', text: candidate.headline, reason: 'product_surface_assertion' };
  }
  for (const sentence of sentences) {
    const matched = matchSentence(sentence, 'body');
    if (matched !== null && matched.templateId !== 'E' && matched.templateId !== 'F') {
      return { rule: 'V11', text: sentence, reason: 'product_surface_assertion' };
    }
  }
  return null;
}

export function filterCitations(
  candidate: Card,
  cluster: Cluster
): { kept: Citation[]; dropped: DroppedClaim[] } {
  const kept: Citation[] = [];
  const dropped: DroppedClaim[] = [];
  const inCluster = new Set<string>(cluster.indicatorIds);
  for (const citation of candidate.citations) {
    if (!inCluster.has(citation.indicatorId)) {
      dropped.push({ rule: 'V1', text: citation.indicatorId, reason: 'unknown_indicator' });
      continue;
    }
    if (citation.surface === candidate.surface) {
      dropped.push({ rule: 'V2', text: citation.indicatorId, reason: 'same_surface' });
      continue;
    }
    kept.push(citation);
  }
  return { kept, dropped };
}

export function checkV3(keptCount: number): DroppedClaim | null {
  if (keptCount < 2) return { rule: 'V3', text: 'citations', reason: 'below_floor' };
  return null;
}

function checkSlot(templateId: string, slot: string, fill: string, ctx: SlotContext): DroppedClaim | null {
  switch (slot) {
    case 'family': {
      const labels = ctx.cluster.tierInputs.families.map((family) => family.replace(/_/g, ' '));
      if (!labels.includes(fill)) return { rule: 'V4b', text: fill, reason: 'slot family unresolved' };
      return null;
    }
    case 'n':
    case 'm': {
      if (!COUNT_SHAPE.test(fill)) return { rule: 'V4b', text: fill, reason: `slot ${slot} not_a_count` };
      return null;
    }
    case 'surface': {
      if (!ctx.cluster.surfaces.some((surface) => surface === fill)) {
        return { rule: 'V4b', text: fill, reason: 'slot surface unresolved' };
      }
      return null;
    }
    case 'timeAgo':
    case 'publishedAgo': {
      if (!AGO_SHAPE.test(fill)) return { rule: 'V4b', text: fill, reason: `slot ${slot} malformed` };
      return null;
    }
    case 'feedName': {
      const attribution = ctx.candidate.provenance.attribution;
      // The trusted value comes from buildCard's feed records, never from a
      // model field; the model's fill must equal it exactly.
      if (attribution === undefined || fill.length === 0 || fill !== attribution.feedName) {
        return { rule: 'V4b', text: fill, reason: 'slot feedName unresolved' };
      }
      return null;
    }
    case 'declineReason': {
      if (!(DECLINE_REASON_CODES as readonly string[]).includes(fill)) {
        return { rule: 'V4b', text: fill, reason: 'slot declineReason unresolved' };
      }
      return null;
    }
    default:
      return { rule: 'V4b', text: fill, reason: `unknown_slot ${slot} in template ${templateId}` };
  }
}

export function checkV4b(
  templateId: string,
  fills: Record<string, string>,
  ctx: SlotContext
): DroppedClaim | null {
  for (const [slot, fill] of Object.entries(fills)) {
    const failure = checkSlot(templateId, slot, fill, ctx);
    if (failure !== null) return failure;
  }
  return null;
}

function tokenHit(text: string, token: string): boolean {
  const lower = text.toLowerCase();
  const needle = token.toLowerCase();
  let idx = lower.indexOf(needle);
  while (idx !== -1) {
    const before = idx === 0 ? '' : lower[idx - 1];
    const after = idx + needle.length >= lower.length ? '' : lower[idx + needle.length];
    if (!/[a-z0-9-]/.test(before) && !/[a-z0-9-]/.test(after)) return true;
    idx = lower.indexOf(needle, idx + 1);
  }
  return false;
}

export function checkV5(text: string): DroppedClaim | null {
  for (const token of URGENCY_TOKENS) {
    if (tokenHit(text, token)) return { rule: 'V5', text, reason: `urgency_token:${token}` };
  }
  for (const token of GUILT_TOKENS) {
    if (tokenHit(text, token)) return { rule: 'V5', text, reason: `guilt_token:${token}` };
  }
  return null;
}

// Count semantics per template sentence: A counts the named surface's cluster
// observations, C counts every linked conversation, E counts the cluster's
// indicators and surfaces. All are cluster aggregates, recomputed here rather
// than trusted from the fill.
function resolveCount(
  templateId: string,
  slot: string,
  fills: Record<string, string>,
  ctx: SlotContext
): number | null {
  if (templateId === 'A' && slot === 'n') {
    const surface = fills['surface'];
    if (surface === undefined) return null;
    const count = ctx.cluster.perSurfaceCounts[surface as ObservationSurface];
    return typeof count === 'number' ? count : null;
  }
  if (templateId === 'C' && slot === 'n') return ctx.cluster.observationIds.length;
  if (templateId === 'E' && slot === 'n') return ctx.cluster.indicatorIds.length;
  if (templateId === 'E' && slot === 'm') return ctx.cluster.surfaces.length;
  return null;
}

export function checkV8(
  templateId: string,
  fills: Record<string, string>,
  ctx: SlotContext
): DroppedClaim | null {
  for (const [slot, fill] of Object.entries(fills)) {
    if (slot === 'n' || slot === 'm') {
      const count = resolveCount(templateId, slot, fills, ctx);
      if (count === null || fill !== String(count)) {
        return { rule: 'V8', text: fill, reason: `slot ${slot} unresolved_numeral` };
      }
    } else if (slot === 'timeAgo') {
      const ok = ctx.candidate.citations.some(
        (citation) => renderAgo(ctx.nowMs, citation.observedAt) === fill
      );
      if (!ok) return { rule: 'V8', text: fill, reason: 'slot timeAgo unresolved_numeral' };
    } else if (slot === 'publishedAgo') {
      const attribution = ctx.candidate.provenance.attribution;
      if (attribution === undefined || fill !== renderAgo(ctx.nowMs, attribution.publishedAt)) {
        return { rule: 'V8', text: fill, reason: 'slot publishedAgo unresolved_numeral' };
      }
    }
    // Every other slot (family, surface, feedName, declineReason) draws from
    // a closed enum or trusted record that V4b already pinned; numerals can
    // only hide in feedName, where they are the feed's own, not invented.
  }
  return null;
}

function checkSentence(text: string, kind: 'headline' | 'body', ctx: SlotContext): DroppedClaim | null {
  const matched = matchSentence(text, kind);
  if (matched === null) return { rule: 'V4a', text, reason: 'no_template_match' };
  const v4b = checkV4b(matched.templateId, matched.fills, ctx);
  if (v4b !== null) return v4b;
  const v5 = checkV5(text);
  if (v5 !== null) return v5;
  const v8 = checkV8(matched.templateId, matched.fills, ctx);
  if (v8 !== null) return v8;
  return null;
}

export function validateCard(candidate: Card, cluster: Cluster, nowMs: number): ValidationResult {
  const v6 = checkV6(candidate);
  if (v6 !== null) return { card: null, dropped: [v6], finalTier: null, demotions: [] };
  const v7 = checkV7(candidate);
  if (v7 !== null) return { card: null, dropped: [v7], finalTier: null, demotions: [] };
  const v11 = checkV11(candidate, nowMs);
  if (v11 !== null) return { card: null, dropped: [v11], finalTier: null, demotions: [] };

  const filtered = filterCitations(candidate, cluster);
  const v3 = checkV3(filtered.kept.length);
  if (v3 !== null) {
    return { card: null, dropped: [...filtered.dropped, v3], finalTier: null, demotions: [] };
  }

  const ctx: SlotContext = { candidate, cluster, nowMs };
  const headlineDrop = checkSentence(candidate.headline, 'headline', ctx);
  const sentences = splitSentences(candidate.body);
  const keptSentences: string[] = [];
  const sentenceDrops: DroppedClaim[] = [];
  if (headlineDrop !== null) sentenceDrops.push(headlineDrop);
  for (const sentence of sentences) {
    const drop = checkSentence(sentence, 'body', ctx);
    if (drop === null) keptSentences.push(sentence);
    else sentenceDrops.push(drop);
  }

  let tier = candidate.tier;
  const demotions: string[] = [];
  if (sentenceDrops.length > 0 && filtered.kept.length < 3) {
    const demoted = demoteTier(tier);
    if (demoted === null) {
      // V9 below context has no tier left to express: the card goes silent
      // rather than emitting at a strength its surviving evidence no longer earns.
      demotions.push(`${tier}->silent`);
      const v9drop: DroppedClaim = { rule: 'V9', text: 'tier', reason: 'demoted_below_context' };
      return {
        card: null,
        dropped: [...filtered.dropped, ...sentenceDrops, v9drop],
        finalTier: null,
        demotions
      };
    }
    demotions.push(`${tier}->${demoted}`);
    tier = demoted;
  }

  if (headlineDrop !== null || keptSentences.length === 0) {
    const v10: DroppedClaim = { rule: 'V10', text: 'card', reason: 'headline_or_body_lost' };
    return {
      card: null,
      dropped: [...filtered.dropped, ...sentenceDrops, v10],
      finalTier: null,
      demotions
    };
  }

  const finalDrops = [...filtered.dropped, ...sentenceDrops];
  return {
    card: {
      ...candidate,
      tier,
      body: keptSentences.join(' '),
      citations: filtered.kept,
      provenance: { ...candidate.provenance, dropped: [...candidate.provenance.dropped, ...finalDrops] }
    },
    dropped: finalDrops,
    finalTier: tier,
    demotions
  };
}
