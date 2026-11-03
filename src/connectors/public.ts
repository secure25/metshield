import type { Observation } from '../contract.js';
import type { FeedAttribution } from '../cards.js';
import { normalizeIndicator } from '../normalize.js';

// Public feed connector: real blocklist URLs in, Observations out. One
// reader per feed URL; each normalises entries to domain indicators and
// hands the pipeline an Observation plus the feed's own attribution (name,
// publication time, asserted claim) for template F. URLs and domains only:
// page bodies are never fetched, DNS is never resolved, no personal data of
// any kind enters the store.
//
// Health, not logs, is the record: lastPollAt tracks the last completed
// poll whatever its outcome, items counts delivered entries, errors counts
// malformed entries plus failed polls. A struggling feed is visible in its
// block rather than in a log tail.

export type FeedFormat = 'lines' | 'json';

export interface FeedEntry {
  url: string;
  publishedAt?: string;
}

export interface JsonAdapterOptions {
  /** Dot path to the entry array when the body is an object (e.g. 'data.urls'). */
  path?: string;
  /** Entry-object key holding the URL. Default 'url'. */
  urlKey?: string;
  /** Entry-object key holding a per-entry publication time. Default 'publishedAt'. */
  publishedKey?: string;
}

export function extractLines(body: string): FeedEntry[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((url) => ({ url }));
}

export function extractJson(body: string, opts: JsonAdapterOptions = {}): FeedEntry[] {
  const parsed: unknown = JSON.parse(body);
  const urlKey = opts.urlKey ?? 'url';
  const publishedKey = opts.publishedKey ?? 'publishedAt';
  let node: unknown = parsed;
  if (opts.path !== undefined && opts.path.length > 0) {
    for (const segment of opts.path.split('.')) {
      if (typeof node !== 'object' || node === null) throw new Error('json path not found');
      node = (node as Record<string, unknown>)[segment];
    }
  }
  if (!Array.isArray(node)) throw new Error('json feed is not an array');
  const entries: FeedEntry[] = [];
  for (const item of node) {
    // Malformed entries become empty URLs and are counted downstream at
    // normalisation, so one bad entry never kills a whole poll.
    if (typeof item === 'string') {
      entries.push({ url: item });
    } else if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>;
      const url = record[urlKey];
      const publishedAt = record[publishedKey];
      entries.push({
        url: typeof url === 'string' ? url : '',
        ...(typeof publishedAt === 'string' ? { publishedAt } : {})
      });
    } else {
      entries.push({ url: '' });
    }
  }
  return entries;
}

export interface FeedOptions {
  name: string;
  url: string;
  format: FeedFormat;
  pollMs: number;
  /** Defaults: extractLines, or extractJson with path below. Custom extractors own their schema. */
  extractor?: (body: string) => FeedEntry[];
  path?: string;
  /** Entry-object key holding the URL. Default 'url'. */
  urlKey?: string;
  /** Entry-object key holding a per-entry publication time. Default 'publishedAt'. */
  publishedKey?: string;
  assertedClaim: FeedAttribution['assertedClaim'];
  /** Config-declared publication time when entries carry none; else fetch time. */
  publishedAt?: string;
  onObservation: (observation: Observation, meta: FeedAttribution) => unknown;
  now?: () => number;
  /** Canonical-domain dedupe cap; default unbounded (feeds are small). */
  seenCap?: number;
  /**
   * Head-sample cap: stop delivering after this many items in a poll.
   * Unset means unbounded. The fetch still pulls the whole list; only
   * processing stops, so health.items counts processed entries and a capped
   * poll must be disclosed as a head sample, never as the full feed.
   */
  maxItems?: number;
}

export interface FeedHealth {
  name: string;
  lastPollAt: string | null;
  items: number;
  errors: number;
}

export interface FeedReader {
  /** Run one poll now. Exposed so tests can drive the reader deterministically. */
  poll: () => Promise<void>;
  stop: () => void;
  getHealth: () => FeedHealth;
}

export function startFeed(options: FeedOptions): FeedReader {
  const extractor =
    options.extractor ??
    (options.format === 'lines'
      ? extractLines
      : (body: string) => extractJson(body, { path: options.path, urlKey: options.urlKey, publishedKey: options.publishedKey }));
  const seenCap = options.seenCap ?? Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  const health: FeedHealth = { name: options.name, lastPollAt: null, items: 0, errors: 0 };
  const now = options.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function poll(): Promise<void> {
    if (stopped) return;
    const at = new Date(now()).toISOString();
    try {
      const res = await fetch(options.url);
      if (!res.ok) {
        health.errors += 1;
        health.lastPollAt = at;
        return;
      }
      let entries: FeedEntry[];
      try {
        entries = extractor(await res.text());
      } catch {
        health.errors += 1;
        health.lastPollAt = at;
        return;
      }
      for (const entry of entries) {
        const normalized = normalizeIndicator({ family: 'domain', value: entry.url });
        if ('rejected' in normalized) {
          health.errors += 1;
          continue;
        }
        if (seen.has(normalized.canonical)) continue;
        seen.add(normalized.canonical);
        if (seen.size > seenCap) {
          const oldest = seen.keys().next();
          if (!oldest.done) seen.delete(oldest.value);
        }
        const observation: Observation = {
          id: `feed:${options.name}:${normalized.canonical}`,
          source: 'public_feed',
          observedAt: at,
          surface: 'public_feed',
          eventKind: 'link',
          actorRef: `feed:${options.name}`,
          subjectRef: null,
          threadRef: null,
          indicators: [{ kind: 'offplatform_link', value: entry.url }],
          claimCodes: ['public_blocklist'],
          consent: 'public_source',
          synthetic: false
        };
        health.items += 1;
        options.onObservation(observation, {
          feedName: options.name,
          publishedAt: entry.publishedAt ?? options.publishedAt ?? at,
          assertedClaim: options.assertedClaim
        });
        if (options.maxItems !== undefined && health.items >= options.maxItems) break;
      }
      health.lastPollAt = at;
    } catch {
      health.errors += 1;
      health.lastPollAt = at;
    }
  }

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      void poll().finally(() => {
        if (!stopped) schedule();
      });
    }, options.pollMs);
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
  }

  // First poll fires after one interval, matching the world reader: manual
  // drivers never race an in-flight boot poll.
  schedule();

  return {
    poll,
    stop: () => {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    getHealth: () => ({ ...health })
  };
}
