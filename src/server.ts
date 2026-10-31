import express from 'express';
import type { Express } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHealth } from './health.js';
import { Pipeline } from './pipeline.js';
import type { ObservationSurface } from './contract.js';
import { parseMultipartImage, submitCreativeSubmission, submitLinkSubmission } from './connectors/submit.js';

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

  // Minimal operator reads (P8 slice of P10): full list newest-first, and
  // the counters. P10 adds clusters, card detail, and cost.
  app.get('/v1/cards', (_req, res) => {
    res.json({ cards: pipeline.getCards() });
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
