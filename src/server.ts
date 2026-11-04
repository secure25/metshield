import express from 'express';
import type { Express } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHealth } from './health.js';
import { Pipeline } from './pipeline.js';
import type { ObservationSurface } from './contract.js';
import { parseMultipartImage, submitCreativeSubmission, submitLinkSubmission } from './connectors/submit.js';
import { startWorldReader } from './connectors/world.js';
import { startFeed } from './connectors/public.js';

const PORT: number = process.env.PORT ? Number(process.env.PORT) : 5173;

function isProductSurface(value: unknown): value is ObservationSurface {
  return value === 'facebook' || value === 'messenger' || value === 'whatsapp';
}

// App factory: tests build isolated apps over fresh pipelines, while the
// default export below serves the live one. Product routes only — world
// routes register separately (and optionally) at boot.
export function createApp(pipeline: Pipeline): Express {
  const app = express();
  app.use(express.json());

  // Operator page: rewrite to the app entry so the client router takes over.
  // Works in dev (Vite serves the transformed entry downstream) and in prod
  // (static middleware serves dist/index.html downstream).
  app.get('/world', (req, _res, next) => {
    req.url = '/index.html';
    next();
  });

  // MetShield operator console (P11): same SPA rewrite as the world page.
  app.get('/console', (req, _res, next) => {
    req.url = '/index.html';
    next();
  });

  // Product API (MetShield proper). Model slots report null until their
  // transports land (P3/P9); the shape is stable from here on.
  app.get('/v1/health', (_req, res) => {
    res.json(getHealth());
  });

  // Submission paths (P9): value + render surface in, a card or a decline
  // reason out. The link front delegates to the P8 pipeline path; the
  // creative path runs SAM, extraction and the same card builder.
  app.post('/v1/submissions/link', (req, res) => {
    void (async () => {
      try {
        const body = (req.body ?? {}) as { value?: unknown; surface?: unknown };
        if (typeof body.value !== 'string' || body.value.trim().length === 0) {
          res.status(400).json({ error: 'value_required' });
          return;
        }
        if (!isProductSurface(body.surface)) {
          res.status(400).json({ error: 'surface_invalid' });
          return;
        }
        const result = await submitLinkSubmission(pipeline, body.value, body.surface);
        res.json({ card: result.card, declineReason: result.declineReason, observationId: result.observationId });
      } catch {
        res.status(500).json({ error: 'pipeline_error' });
      }
    })();
  });

  // Multipart image in; the parser caps files at 5MB with a JSON 413. The raw
  // body limit sits above that at 6MB, so only a file between the two limits
  // falls through to Express's default HTML 413 — accepted, not handled.
  app.post('/v1/submissions/creative', express.raw({ type: 'multipart/form-data', limit: '6mb' }), (req, res) => {
    void (async () => {
      try {
        const contentTypeHeader = req.headers['content-type'];
        const parsed = parseMultipartImage(
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
        );
        if (!parsed.ok) {
          res.status(parsed.code === 'file_too_large' ? 413 : 400).json({ error: parsed.code });
          return;
        }
        const surfaceField = parsed.fields.get('surface');
        const surface = surfaceField === undefined ? 'facebook' : surfaceField;
        if (!isProductSurface(surface)) {
          res.status(400).json({ error: 'surface_invalid' });
          return;
        }
        const result = await submitCreativeSubmission(pipeline, parsed.file, surface);
        res.json({
          card: result.card,
          declineReason: result.declineReason,
          observationId: result.observationId,
          regions: result.regions,
          annotatedImageRef: result.annotatedImageRef
        });
      } catch {
        res.status(500).json({ error: 'pipeline_error' });
      }
    })();
  });

  // Operator reads (P10): clusters, a paged card list newest-first, card
  // detail with the model's proposal, and the metered counters.
  app.get('/v1/clusters', (_req, res) => {
    res.json({ clusters: pipeline.getClusters() });
  });

  app.get('/v1/cards', (req, res) => {
    const limitRaw = req.query.limit;
    let limit = 50;
    if (limitRaw !== undefined) {
      const parsed = typeof limitRaw === 'string' ? Number(limitRaw) : NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
        res.status(400).json({ error: 'limit_invalid' });
        return;
      }
      limit = parsed;
    }
    const cursorRaw = req.query.cursor;
    const cursor = typeof cursorRaw === 'string' ? cursorRaw : undefined;
    if (cursor !== undefined && pipeline.getCard(cursor) === undefined) {
      res.status(404).json({ error: 'cursor_unknown' });
      return;
    }
    res.json(pipeline.getCardsPage(limit, cursor));
  });

  app.get('/v1/cards/:id', (req, res) => {
    const card = pipeline.getCard(req.params.id);
    if (card === undefined) {
      res.status(404).json({ error: 'card_not_found' });
      return;
    }
    res.json({ card, proposal: pipeline.getProposal(card.id) ?? null });
  });

  app.get('/v1/metrics', (_req, res) => {
    res.json(pipeline.getMetrics());
  });

  return app;
}

const pipeline = new Pipeline({
  root: process.env.METASHIELD_RUN_DIR ?? path.resolve('runs'),
  runId: `live-${Date.now()}`
});
const app = createApp(pipeline);

// Living World routes are optional at boot: the dynamic import below is the
// only contact this file has with src/world. With the world absent the import
// fails, one line is logged, and the product API still serves. Awaited at
// module load so the exported app is fully routed before any importer (tests,
// tooling, the listener below) can use it.
try {
  const { registerWorldRoutes } = await import('./world/routes.js');
  registerWorldRoutes(app);
} catch {
  console.log(JSON.stringify({ event: 'world_absent' }));
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

export interface WorldReaderConfig {
  baseUrl: string;
  intervalMs: number;
}

// Env-gated world ingest: unset WORLD_BASE_URL (the default) keeps the
// product pipeline fed only by submissions, preserving the boundary test and
// every existing test's behavior; set it (loopback for the bundled fixture)
// and boot starts the P7 reader into the live pipeline. Pure so tests pin the
// switch without polling. Cards still build only on submissions — ingest
// records evidence, it never spends model calls by itself.
export function resolveWorldReaderConfig(env: Record<string, string | undefined>): WorldReaderConfig | null {
  const baseUrl = env.WORLD_BASE_URL;
  if (baseUrl === undefined || baseUrl === '') return null;
  const raw = env.WORLD_POLL_MS;
  const parsed = raw === undefined || raw === '' ? NaN : Number.parseInt(raw, 10);
  return { baseUrl, intervalMs: Number.isInteger(parsed) && parsed > 0 ? parsed : 5000 };
}

// Feed re-poll cadence: the spec's 10-minute timer. No env override —
// re-poll timing is not filming-relevant, and the first poll fires at boot.
const FEED_POLL_MS = 600000;

export interface FeedReaderConfig {
  url: string;
  name: string;
  format: 'lines' | 'json';
  path: string;
  urlKey: string;
  publishedKey: string;
  claim: 'listing' | 'live_phishing' | 'takedown';
  maxItems?: number;
  publishedAt?: string;
}

// Env-gated feed ingest: unset LIVE_FEED_URL (the default) keeps the product
// pipeline fed only by submissions and the world reader, preserving the
// boundary test and every existing test's behavior; set it and boot starts
// the P8 reader into the live pipeline. Never throws: bad values fall back
// to the same defaults scripts/live-public.ts documents, so a typo degrades
// to an empty feed (visible as public_feed 0 in metrics) rather than killing
// dev. Deliberately NOT shared with that script's resolver, which requires a
// model key — keyless dev must still boot and ingest model-free.
export function resolveFeedReaderConfig(env: Record<string, string | undefined>): FeedReaderConfig | null {
  const url = env.LIVE_FEED_URL;
  if (url === undefined || url === '') return null;
  const pick = (value: string | undefined, fallback: string): string =>
    value === undefined || value === '' ? fallback : value;
  const formatRaw = pick(env.LIVE_FEED_FORMAT, 'json');
  const format: 'lines' | 'json' = formatRaw === 'lines' || formatRaw === 'json' ? formatRaw : 'json';
  const claimRaw = pick(env.LIVE_FEED_CLAIM, 'listing');
  const claim: 'listing' | 'live_phishing' | 'takedown' =
    claimRaw === 'listing' || claimRaw === 'live_phishing' || claimRaw === 'takedown' ? claimRaw : 'listing';
  const maxItemsRaw = pick(env.LIVE_FEED_MAX_ITEMS, '');
  const parsed = maxItemsRaw === '' ? undefined : Number.parseInt(maxItemsRaw, 10);
  const maxItems = parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  const publishedRaw = pick(env.LIVE_FEED_PUBLISHED_AT, '');
  const publishedAt = publishedRaw !== '' && !Number.isNaN(Date.parse(publishedRaw)) ? publishedRaw : undefined;
  return {
    url,
    name: pick(env.LIVE_FEED_NAME, 'phishing-database'),
    format,
    path: pick(env.LIVE_FEED_PATH, 'urls'),
    urlKey: pick(env.LIVE_FEED_URL_KEY, 'url'),
    publishedKey: pick(env.LIVE_FEED_PUBLISHED_KEY, 'dateadded'),
    claim,
    ...(maxItems === undefined ? {} : { maxItems }),
    ...(publishedAt === undefined ? {} : { publishedAt })
  };
}

async function start(): Promise<void> {
  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares as unknown as express.RequestHandler);
  } else {
    const dist = path.resolve(HERE, '../dist');
    app.use(express.static(dist));
  }
  app.listen(PORT, () => {
    console.log(`metshield dev server on http://localhost:${PORT}`);
  });
  const worldReader = resolveWorldReaderConfig(process.env);
  if (worldReader !== null) {
    startWorldReader({
      baseUrl: worldReader.baseUrl,
      intervalMs: worldReader.intervalMs,
      onObservation: (observation) => {
        pipeline.ingest(observation);
      }
    });
    console.log(
      JSON.stringify({ event: 'world_reader', baseUrl: worldReader.baseUrl, intervalMs: worldReader.intervalMs })
    );
  }
  const feedReader = resolveFeedReaderConfig(process.env);
  if (feedReader !== null) {
    const feed = startFeed({
      url: feedReader.url,
      name: feedReader.name,
      format: feedReader.format,
      path: feedReader.path,
      urlKey: feedReader.urlKey,
      publishedKey: feedReader.publishedKey,
      assertedClaim: feedReader.claim,
      ...(feedReader.publishedAt !== undefined ? { publishedAt: feedReader.publishedAt } : {}),
      ...(feedReader.maxItems !== undefined ? { maxItems: feedReader.maxItems } : {}),
      pollMs: FEED_POLL_MS,
      onObservation: (observation, meta) => {
        pipeline.ingest(observation, meta);
      }
    });
    // First poll now: the reader's own timer starts after one interval, which
    // at feed cadence would leave boot with an empty feed for ten minutes.
    void feed.poll();
    console.log(
      JSON.stringify({ event: 'feed_reader', feed: feedReader.name, url: feedReader.url, pollMs: FEED_POLL_MS })
    );
  }
}

// Only listen when executed directly: importing the app (tests, tooling)
// must not bind a port. Matches any argv entry so tsx, node, and future
// runners all boot; test workers never name this file.
const SELF = fileURLToPath(import.meta.url);
const invokedDirectly = process.argv.slice(1).some((arg) => path.resolve(arg) === SELF);
if (invokedDirectly) {
  start().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

export default app;
