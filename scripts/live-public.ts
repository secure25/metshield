// Live public test: real feed + real proposer, no fixture, no stand-in.
// Polls a public URL feed once, submits argv values through the production
// pipeline (model calls billed), and prints per-submission outcomes plus the
// metrics block. runs/live-public-*/ keeps the JSONL.
//
//   LIVE_FEED_URL=https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/refs/heads/master/phishing-domains-ACTIVE.txt \
//   npm run live:public -- evil.example https://other.example/x \
//     --creative ./ad.png --surface messenger
//
// Env (all optional except the feed URL and the model key):
//   LIVE_FEED_NAME, LIVE_FEED_FORMAT (lines|json), LIVE_FEED_PATH (json array
//   dot-path), LIVE_FEED_URL_KEY, LIVE_FEED_PUBLISHED_KEY, LIVE_FEED_CLAIM
//   (listing|live_phishing|takedown). METASHIELD_BASE_URL / METASHIELD_API_KEY
//   are required: this script refuses to run scripted, because a "public
//   test" on a stand-in proposer would prove nothing.
//
// Before first use, confirm the feed's terms permit this use. The default
// feed (Phishing.Database phishing-domains-ACTIVE, MIT-licensed, vintage
// Oct 2026, PyFunceble-tested) explicitly invites tool and product use, and
// attribution is automatic — every feed-built card carries the feed name
// (template F). Claim 'listing' is the honest strength for a community
// list, not live-verified phishing. Constraints hold here as in
// production: URLs and domains only, page bodies never fetched, DNS never
// resolved, no personal data enters the store.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pipeline } from '../src/pipeline.js';
import { startFeed } from '../src/connectors/public.js';
import type { FeedAttribution } from '../src/cards.js';
import { submitCreativeSubmission, submitLinkSubmission } from '../src/connectors/submit.js';
import type { ObservationSurface } from '../src/contract.js';

export interface LiveArgs {
  values: string[];
  creatives: string[];
  surface: ObservationSurface;
}

export function parseLiveArgs(argv: string[]): LiveArgs {
  const values: string[] = [];
  const creatives: string[] = [];
  let surface: ObservationSurface = 'messenger';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--creative') {
      const next = argv[i + 1];
      if (next === undefined || next.length === 0) throw new Error('--creative needs a file path');
      creatives.push(next);
      i += 1;
    } else if (arg === '--surface') {
      const next = argv[i + 1];
      if (next !== 'facebook' && next !== 'messenger' && next !== 'whatsapp') {
        throw new Error(`--surface must be facebook, messenger or whatsapp, got ${next ?? '(missing)'}`);
      }
      surface = next;
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag ${arg}`);
    } else {
      values.push(arg);
    }
  }
  if (values.length === 0 && creatives.length === 0) {
    throw new Error('submit at least one value or --creative <path>');
  }
  return { values, creatives, surface };
}

function feedEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? fallback : value;
}

async function main(): Promise<void> {
  const feedUrl = process.env.LIVE_FEED_URL;
  if (feedUrl === undefined || feedUrl.length === 0) {
    throw new Error('LIVE_FEED_URL must be set to a public feed URL (confirm its terms first)');
  }
  if (!process.env.METASHIELD_BASE_URL || !process.env.METASHIELD_API_KEY) {
    throw new Error('METASHIELD_BASE_URL and METASHIELD_API_KEY must be set: this script uses the real proposer only');
  }
  const format = feedEnv('LIVE_FEED_FORMAT', 'json');
  if (format !== 'lines' && format !== 'json') throw new Error(`LIVE_FEED_FORMAT must be lines or json, got ${format}`);
  const claim = feedEnv('LIVE_FEED_CLAIM', 'listing');
  if (claim !== 'listing' && claim !== 'live_phishing' && claim !== 'takedown') {
    throw new Error(`LIVE_FEED_CLAIM must be listing, live_phishing or takedown, got ${claim}`);
  }
  const args = parseLiveArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runId = `live-public-${stamp}`;
  const root = path.resolve('runs');
  const pipeline = new Pipeline({ root, runId });

  const feedName = feedEnv('LIVE_FEED_NAME', 'phishing-database');
  const sample: string[] = [];
  const reader = startFeed({
    name: feedName,
    url: feedUrl,
    format,
    pollMs: 60000,
    path: feedEnv('LIVE_FEED_PATH', 'urls'),
    urlKey: feedEnv('LIVE_FEED_URL_KEY', 'url'),
    publishedKey: feedEnv('LIVE_FEED_PUBLISHED_KEY', 'dateadded'),
    assertedClaim: claim as FeedAttribution['assertedClaim'],
    onObservation: (obs, meta) => {
      if (sample.length < 5) {
        const prefix = `feed:${feedName}:`;
        sample.push(obs.id.startsWith(prefix) ? obs.id.slice(prefix.length) : obs.id);
      }
      pipeline.ingest(obs, meta);
    }
  });
  try {
    await reader.poll();
  } finally {
    reader.stop();
  }
  const health = reader.getHealth();
  console.log(JSON.stringify({ event: 'live_feed', feed: feedName, items: health.items, errors: health.errors }));
  if (sample.length > 0) {
    console.log(JSON.stringify({ event: 'live_feed_sample', domains: sample }));
  }

  for (const value of args.values) {
    const result = await submitLinkSubmission(pipeline, value, args.surface);
    console.log(
      JSON.stringify({
        event: 'live_submission',
        kind: 'link',
        value,
        card: result.card === null ? null : { id: result.card.id, tier: result.card.tier, template: result.card.template ?? null },
        declineReason: result.declineReason,
        observationId: result.observationId
      })
    );
  }
  for (const filePath of args.creatives) {
    const data = fs.readFileSync(filePath);
    const mime = filePath.toLowerCase().endsWith('.png')
      ? 'image/png'
      : filePath.toLowerCase().endsWith('.svg')
        ? 'image/svg+xml'
        : 'image/jpeg';
    const result = await submitCreativeSubmission(
      pipeline,
      { data, filename: path.basename(filePath), mime },
      args.surface
    );
    console.log(
      JSON.stringify({
        event: 'live_submission',
        kind: 'creative',
        value: filePath,
        regions: result.regions.length,
        card: result.card === null ? null : { id: result.card.id, tier: result.card.tier, template: result.card.template ?? null },
        declineReason: result.declineReason,
        annotatedImageRef: result.annotatedImageRef
      })
    );
  }
  console.log(JSON.stringify({ event: 'live_metrics', metrics: pipeline.getMetrics() }));
}

// Guarded: importing this module (unit tests import parseLiveArgs) must not
// poll feeds, bill calls, or set the process exit code.
const liveEntryHref = process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href;
if (liveEntryHref !== null && liveEntryHref === import.meta.url) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: 'live_failed', detail: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
