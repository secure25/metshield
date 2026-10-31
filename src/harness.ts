import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Observation, ObservationSurface } from './contract.js';
import { Pipeline } from './pipeline.js';
import type { PipelineMetrics } from './pipeline.js';
import { resetCardSequence } from './cards.js';
import type { Card, ProposeFn } from './cards.js';
import type { Cluster } from './correlate.js';
import { startFeed } from './connectors/public.js';
import { CARD_TEMPLATES_V1 } from './copy/card.v1.js';
import { normalizeIndicator } from './normalize.js';
import { renderAgo } from './validate.js';
import { HONESTY_LIMITATIONS } from './honesty.js';
import { OPERATOR_HEADER, OPERATOR_KEY } from './operatorAuth.js';

// Run harness (P12): fixed scenarios end to end, each writing runs/<runId>/
// report.md. Two modes, one report builder:
//
// - public: loopback feed (fixture blocklist over real HTTP) plus fixed link
//   submissions. No world code is loaded at all — the strongest reading of
//   "no world process" — and the run asserts the P8 property end to end.
// - world: the real Living World over HTTP (seeded, advanced, cursor-paged)
//   plus the same feed and submissions derived from observed links.
//
// Both use a scripted proposer, stated on the report: demos must run anywhere
// with zero credentials and replay byte-identically. Live-model runs pass a
// real proposer explicitly; nothing here pretends the script is the model.

export const DEMO_SEED = 42;
export const DEMO_FIXED_NOW_MS = Date.parse('2026-06-10T12:00:00.000Z');
export const DEMO_FEED_PUBLISHED_AT = '2026-06-05T12:00:00.000Z';
export const DEMO_FEED_NAME = 'example-feed';
export const WORLD_BATCH_LIMIT = 8000;
export const WORLD_ADVANCE_MINUTES = 300;
export const WORLD_SUBMISSION_COUNT = 3;

export const REQUIRED_HEADINGS: string[] = [
  '## Scenario',
  '## Source mix',
  '## Observations',
  '## Clusters',
  '## Cards by tier',
  '## Declines by reason',
  '## Demotions by rule',
  '## Model latency',
  '## Cost estimate',
  '## Limitations',
  '## Assertions'
];

export interface ScriptedProposerOptions {
  feedName: string;
  feedPublishedAt: string;
  nowMs: number;
}

function fillCopy(id: string, fills: Record<string, string>): { headline: string; body: string } {
  const template = CARD_TEMPLATES_V1.find((entry) => entry.id === id);
  if (template === undefined) throw new Error(`no template ${id}`);
  const fill = (text: string): string => {
    let out = text;
    for (const [key, value] of Object.entries(fills)) out = out.split(`{${key}}`).join(value);
    return out;
  };
  return { headline: template.headline, body: template.body.map(fill).join(' ') };
}

function surfaceFor(cluster: Cluster): ObservationSurface {
  const ranked = [...cluster.surfaces].sort();
  for (const surface of ranked) {
    if ((cluster.perSurfaceCounts[surface] ?? 0) > 0) return surface;
  }
  return ranked[0] ?? 'facebook';
}

// Deterministic stand-in for the reasoner: blocklisted clusters get template
// F, everything else gets template A with the count the validator recomputes.
// Zero tokens either way — the meter reports what the stub consumed, honestly.
export function scriptedProposer(opts: ScriptedProposerOptions): ProposeFn {
  return async (cluster, indicators) => {
    const domain = indicators.find((stored) => stored.indicator.family === 'domain');
    if (domain === undefined) {
      return {
        ok: true,
        data: {
          decision: 'decline',
          tier: null,
          headline: null,
          body: null,
          safeAction: null,
          citations: [],
          declineReason: 'single_family',
          confidence: 0.2
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        ms: 0
      };
    }
    const feedListed = cluster.claimCodes.includes('public_blocklist');
    const surface = surfaceFor(cluster);
    const copy = feedListed
      ? fillCopy('F', { feedName: opts.feedName, publishedAgo: renderAgo(opts.nowMs, opts.feedPublishedAt) })
      : fillCopy('A', {
          family: 'domain',
          n: String(cluster.perSurfaceCounts[surface] ?? 0),
          surface
        });
    return {
      ok: true,
      data: {
        decision: 'emit',
        tier: feedListed ? 'confirmed' : 'corroborated',
        headline: copy.headline,
        body: copy.body,
        safeAction: 'leave_and_report',
        citations: [domain.id, domain.id],
        declineReason: null,
        confidence: 0.8
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      ms: 0
    };
  };
}

export interface FeedServer {
  url: string;
  close: () => Promise<void>;
}

// The fixture feed over real loopback HTTP: the connector performs a genuine
// GET through its adapter, dedupe, and attribution path against fixed bytes.
// Fixed bytes, not a live third-party list — those need per-feed terms checks
// (§8.3) and would make the demo nondeterministic.
export async function serveFeed(body: string): Promise<FeedServer> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/feed.txt`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  };
}

export interface WorldBatch {
  observations: Observation[];
  seed: number;
  tick: number;
}

// Advance-then-collect against a live world server: one control POST steps a
// fresh seeded world into campaign territory, then cursor pages take a bounded
// prefix. The prefix of a fixed seed is content-deterministic across
// processes; later ticks only append.
export async function collectWorldBatch(
  baseUrl: string,
  seed: number,
  advanceMinutes: number,
  limit: number
): Promise<WorldBatch> {
  const controlRes = await fetch(`${baseUrl}/api/world/control?seed=${seed}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [OPERATOR_HEADER]: OPERATOR_KEY },
    body: JSON.stringify({ minutes: advanceMinutes })
  });
  if (!controlRes.ok) throw new Error(`world control -> ${controlRes.status}`);
  const control = (await controlRes.json()) as { seed: number; tick: number };
  const observations: Observation[] = [];
  let cursor = 0;
  for (let pages = 0; pages < 50 && observations.length < limit; pages++) {
    const res = await fetch(`${baseUrl}/api/world/observations?seed=${seed}&cursor=${cursor}&limit=1000`);
    if (!res.ok) throw new Error(`world observations -> ${res.status}`);
    const page = (await res.json()) as { observations: Observation[]; nextCursor?: number | null };
    if (page.observations.length === 0) break;
    observations.push(...page.observations);
    if (page.nextCursor === null || page.nextCursor === undefined || page.nextCursor <= cursor) break;
    cursor = page.nextCursor;
  }
  return { observations: observations.slice(0, limit), seed: control.seed, tick: control.tick };
}

export interface ReportInput {
  mode: 'world' | 'public';
  seed: number;
  runId: string;
  proposer: string;
  metrics: PipelineMetrics;
  cards: Card[];
  submissions: string[];
  feed: { name: string; publishedAt: string; transport: string };
  worldTick?: number;
  notes: string[];
  assertions: string[];
}

export function writeReport(runDir: string, input: ReportInput): string {
  fs.mkdirSync(runDir, { recursive: true });
  const m = input.metrics;
  const byRule = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const card of input.cards) {
    for (const dropped of card.provenance.dropped) {
      byRule.set(dropped.rule, (byRule.get(dropped.rule) ?? 0) + 1);
    }
    const proposed = card.provenance.proposedTier;
    if (proposed !== null && proposed !== card.tier) {
      const pair = `${proposed}->${card.tier}`;
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
    }
  }
  const byTierLines = (Object.keys(m.byTier) as Array<keyof typeof m.byTier>)
    .sort()
    .map((tier) => {
      const ids = input.cards.filter((card) => card.tier === tier).map((card) => card.id);
      return `- ${tier}: ${m.byTier[tier]}${ids.length > 0 ? ` (${ids.join(', ')})` : ''}`;
    });
  const declineEntries = Object.entries(m.silentByReason).sort((a, b) => b[1] - a[1]);
  const lines: string[] = [];
  lines.push(`# MetShield run report — ${input.runId}`, '');
  lines.push('## Scenario');
  lines.push(`- mode: ${input.mode}`);
  lines.push(`- seed: ${input.seed}`);
  lines.push(`- run: ${input.runId}`);
  lines.push(`- proposer: ${input.proposer}`);
  lines.push(`- feed: ${input.feed.name} (published ${input.feed.publishedAt}, ${input.feed.transport})`);
  if (input.worldTick !== undefined) lines.push(`- world tick after advance: ${input.worldTick}`);
  lines.push(`- submissions (${input.submissions.length}):`);
  for (const value of input.submissions) lines.push(`  - ${value}`);
  for (const note of input.notes) lines.push(`- note: ${note}`);
  lines.push('');
  lines.push('## Source mix');
  for (const source of ['world', 'public_feed', 'submission'] as const) {
    lines.push(`- ${source}: ${m.observations.bySource[source]}`);
  }
  lines.push(`- synthetic: ${m.observations.synthetic} of ${m.observations.total}`);
  lines.push('');
  lines.push('## Observations', `- total: ${m.observations.total}`, '');
  lines.push('## Clusters', `- open: ${m.clusters}`, '');
  lines.push('## Cards by tier', ...byTierLines, `- emitted: ${m.cards}`, '');
  lines.push(
    '## Declines by reason',
    ...(declineEntries.length === 0 ? ['- none'] : declineEntries.map(([reason, count]) => `- ${reason}: ${count}`)),
    ''
  );
  const dropLines =
    byRule.size === 0
      ? ['- drops by rule: none']
      : [...byRule.entries()]
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .map(([rule, count]) => `- ${rule}: ${count}`);
  const pairLines =
    pairs.size === 0
      ? ['- demotion pairs: none']
      : [...pairs.entries()]
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .map(([pair, count]) => `- ${pair}: ${count}`);
  lines.push('## Demotions by rule', ...dropLines, ...pairLines, `- demotion events: ${m.demotions}`, '');
  lines.push(
    '## Model latency',
    m.modelCalls === 0 ? '- n/a (no model calls)' : `- mean: ${(m.modelMs / m.modelCalls).toFixed(2)} ms over ${m.modelCalls} calls`,
    ''
  );
  lines.push(
    '## Cost estimate',
    `- $${m.costEstimateUsd.toFixed(6)} estimated at contributor rates ($0.10/MTok in, $0.20/MTok out)`,
    ''
  );
  lines.push('## Limitations', ...HONESTY_LIMITATIONS.map((clause) => `- ${clause}`), '');
  lines.push('## Assertions', ...input.assertions.map((line) => `- ${line}`), '');
  const file = path.join(runDir, 'report.md');
  fs.writeFileSync(file, `${lines.join('\n')}`, 'utf8');
  return file;
}

export interface DemoResult {
  runId: string;
  runDir: string;
  reportPath: string;
  metrics: PipelineMetrics;
  cards: Card[];
}

export interface PublicDemoOptions {
  seed: number;
  rootDir: string;
  feedBody: string;
  submissions?: string[];
}

async function pollFixtureFeed(
  pipeline: Pipeline,
  feedBody: string,
  nowMs: number
): Promise<{ name: string; publishedAt: string; transport: string }> {
  const feed = await serveFeed(feedBody);
  try {
    const reader = startFeed({
      name: DEMO_FEED_NAME,
      url: feed.url,
      format: 'lines',
      pollMs: 60000,
      assertedClaim: 'listing',
      publishedAt: DEMO_FEED_PUBLISHED_AT,
      onObservation: (obs, meta) => {
        pipeline.ingest(obs, meta);
      },
      now: () => nowMs
    });
    try {
      await reader.poll();
    } finally {
      reader.stop();
    }
  } finally {
    await feed.close();
  }
  // The URL carries an ephemeral port, so the report records the transport,
  // not the address — otherwise two identical runs would differ on paper.
  return { name: DEMO_FEED_NAME, publishedAt: DEMO_FEED_PUBLISHED_AT, transport: 'loopback HTTP (fixture)' };
}

export function assertPublicResult(metrics: PipelineMetrics, cards: Card[]): void {
  if (metrics.observations.synthetic !== 0) {
    throw new Error(`demo:public observed ${metrics.observations.synthetic} synthetic observations, expected 0`);
  }
  const confirmed = cards.filter((card) => card.tier === 'confirmed');
  if (confirmed.length < 1) throw new Error('demo:public produced no confirmed card');
  for (const card of confirmed) {
    if (card.template !== 'F') {
      throw new Error(`demo:public confirmed card ${card.id} is template ${card.template ?? 'unset'}, expected F`);
    }
    if (card.provenance.evidenceBasis !== 'source_reported') {
      throw new Error(`demo:public confirmed card ${card.id} is ${card.provenance.evidenceBasis}, expected source_reported`);
    }
    const attribution = card.provenance.attribution;
    if (attribution?.feedName === undefined || attribution.publishedAt === undefined || attribution.assertedClaim === undefined) {
      throw new Error(`demo:public confirmed card ${card.id} lacks complete attribution`);
    }
    const surfaces = new Set(card.citations.map((citation) => citation.surface));
    if (!surfaces.has('public_feed') || !surfaces.has('user_submission')) {
      throw new Error(`demo:public confirmed card ${card.id} is not feed-plus-submission cited`);
    }
    if (new Set(card.citations.map((citation) => citation.observationId)).size < 2) {
      throw new Error(`demo:public confirmed card ${card.id} cites fewer than two observations`);
    }
  }
}

export async function runPublicDemo(opts: PublicDemoOptions): Promise<DemoResult> {
  const runId = `demo-public-${opts.seed}`;
  const runDir = path.join(opts.rootDir, runId);
  fs.rmSync(runDir, { recursive: true, force: true });
  resetCardSequence();
  const nowMs = DEMO_FIXED_NOW_MS;
  const pipeline = new Pipeline({
    root: opts.rootDir,
    runId,
    now: () => nowMs,
    propose: scriptedProposer({ feedName: DEMO_FEED_NAME, feedPublishedAt: DEMO_FEED_PUBLISHED_AT, nowMs })
  });
  const feed = await pollFixtureFeed(pipeline, opts.feedBody, nowMs);
  const submissions = opts.submissions ?? ['https://evil.example/offer', 'other.example', 'fresh.example'];
  for (const value of submissions) {
    await pipeline.submitLink(value, 'messenger');
  }
  const metrics = pipeline.getMetrics();
  const cards = pipeline.getCards();
  assertPublicResult(metrics, cards);
  const reportPath = writeReport(runDir, {
    mode: 'public',
    seed: opts.seed,
    runId,
    proposer: 'scripted (deterministic stand-in; live runs use muse-spark-1.3-contributor)',
    metrics,
    cards,
    submissions,
    feed,
    notes: ['no world code is loaded on this path; the feed and the submissions are the whole input'],
    assertions: [
      `zero synthetic observations: passed (${metrics.observations.synthetic})`,
      `confirmed F card with attribution: passed (${cards.filter((card) => card.tier === 'confirmed').length})`
    ]
  });
  return { runId, runDir, reportPath, metrics, cards };
}

export interface DerivedSubmission {
  value: string;
  cardSurface: ObservationSurface;
}

const PRODUCT_SURFACES: ObservationSurface[] = ['facebook', 'messenger', 'whatsapp'];

// Submissions derived from the batch itself: the first distinct parseable
// domains the world actually emitted, each rendered on a product surface the
// cluster does not already cover — so citation resolution always has two
// eligible observations and every submission can genuinely emit.
export function deriveSubmissions(observations: Observation[], count: number): DerivedSubmission[] {
  const seen = new Set<string>();
  const surfacesByCanonical = new Map<string, Set<ObservationSurface>>();
  const valueByCanonical = new Map<string, string>();
  for (const obs of observations) {
    for (const item of obs.indicators) {
      if (item.kind !== 'offplatform_link') continue;
      const parsed = normalizeIndicator({ family: 'domain', value: item.value });
      if ('rejected' in parsed) continue;
      if (!seen.has(parsed.canonical)) {
        seen.add(parsed.canonical);
        valueByCanonical.set(parsed.canonical, item.value);
        surfacesByCanonical.set(parsed.canonical, new Set());
      }
      surfacesByCanonical.get(parsed.canonical)?.add(obs.surface);
    }
  }
  const out: DerivedSubmission[] = [];
  for (const canonical of seen) {
    if (out.length >= count) break;
    const value = valueByCanonical.get(canonical);
    if (value === undefined) continue;
    const covered = surfacesByCanonical.get(canonical) ?? new Set<ObservationSurface>();
    out.push({ value, cardSurface: PRODUCT_SURFACES.find((surface) => !covered.has(surface)) ?? 'messenger' });
  }
  return out;
}

export function assertWorldResult(metrics: PipelineMetrics, cards: Card[]): void {
  if (metrics.observations.synthetic <= 0) {
    throw new Error('demo:world observed no synthetic (world) observations');
  }
  if (cards.length < 1) throw new Error('demo:world produced no card');
}

export interface WorldDemoOptions {
  seed: number;
  rootDir: string;
  feedBody: string;
  submissionCount?: number;
}

export async function runWorldScenario(batch: WorldBatch, opts: WorldDemoOptions): Promise<DemoResult> {
  const runId = `demo-world-${opts.seed}`;
  const runDir = path.join(opts.rootDir, runId);
  fs.rmSync(runDir, { recursive: true, force: true });
  resetCardSequence();
  // The pipeline clock follows the batch: world observations carry sim time,
  // and a fixed clock months later would expire every one of them under TTL
  // before a citation could resolve.
  const batchMax = batch.observations.reduce((max, obs) => Math.max(max, Date.parse(obs.observedAt)), 0);
  const nowMs = batchMax + 3600000;
  const pipeline = new Pipeline({
    root: opts.rootDir,
    runId,
    now: () => nowMs,
    propose: scriptedProposer({ feedName: DEMO_FEED_NAME, feedPublishedAt: DEMO_FEED_PUBLISHED_AT, nowMs })
  });
  for (const obs of batch.observations) {
    pipeline.ingest(obs);
  }
  const feed = await pollFixtureFeed(pipeline, opts.feedBody, nowMs);
  const derived = deriveSubmissions(batch.observations, opts.submissionCount ?? WORLD_SUBMISSION_COUNT);
  for (const submission of derived) {
    await pipeline.submitLink(submission.value, submission.cardSurface);
  }
  const metrics = pipeline.getMetrics();
  const cards = pipeline.getCards();
  assertWorldResult(metrics, cards);
  const reportPath = writeReport(runDir, {
    mode: 'world',
    seed: opts.seed,
    runId,
    proposer: 'scripted (deterministic stand-in; live runs use muse-spark-1.3-contributor)',
    metrics,
    cards,
    submissions: derived.map((submission) => `${submission.value} (as ${submission.cardSurface})`),
    feed,
    worldTick: batch.tick,
    notes: ['world observations arrived over HTTP from a seeded server; submissions were derived from observed links'],
    assertions: [
      `world mix present: passed (${metrics.observations.bySource.world} world observations)`,
      `at least one card: passed (${cards.length})`
    ]
  });
  return { runId, runDir, reportPath, metrics, cards };
}

export function printResult(result: DemoResult): void {
  const header = fs
    .readFileSync(result.reportPath, 'utf8')
    .split('\n')
    .slice(0, 14)
    .join('\n');
  console.log(`=== ${result.runId} ===`);
  console.log(`report: ${result.reportPath}`);
  console.log(header);
  console.log('--- metrics ---');
  console.log(JSON.stringify(result.metrics));
}
