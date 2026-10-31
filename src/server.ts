import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHealth } from './health.js';

const app = express();
const PORT: number = process.env.PORT ? Number(process.env.PORT) : 5173;

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
