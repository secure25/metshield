import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorldState, getWorldSummary, DEFAULT_SEED } from './world/state.js';
import type { WorldState } from './world/types.js';

const app = express();
const PORT: number = process.env.PORT ? Number(process.env.PORT) : 5173;

const worlds = new Map<number, WorldState>();

function getWorld(seed: number): WorldState {
  let w = worlds.get(seed);
  if (!w) {
    w = createWorldState(seed);
    worlds.set(seed, w);
  }
  return w;
}

function parseSeed(value: unknown): number {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return DEFAULT_SEED;
}

getWorld(DEFAULT_SEED);

app.get('/api/world/state', (req, res) => {
  const seed = parseSeed(req.query.seed);
  res.json(getWorldSummary(getWorld(seed)));
});

app.get('/api/world/accounts', (req, res) => {
  const seed = parseSeed(req.query.seed);
  const world = getWorld(seed);
  res.json(
    world.accounts.map((a) => ({
      id: a.id,
      handle: a.handle,
      displayName: a.displayName,
      surface: a.surface,
      archetype: a.persona.archetype,
      role: a.role
    }))
  );
});

app.get('/api/world/events', (req, res) => {
  const seed = parseSeed(req.query.seed);
  const world = getWorld(seed);
  const lim = req.query.limit;
  if (typeof lim === 'string' && lim.length > 0) {
    const n = Number.parseInt(lim, 10);
    if (Number.isFinite(n) && n >= 0) {
      res.json(n === 0 ? [] : world.events.slice(-n));
      return;
    }
  }
  res.json(world.events);
});

app.get('/api/world/accounts/:id', (req, res) => {
  const seed = parseSeed(req.query.seed);
  const world = getWorld(seed);
  const id = req.params.id;
  const account = world.accounts.find((a) => a.id === id);
  if (!account) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const linked = world.accounts.filter((a) => a.personId === account.personId && a.id !== account.id);
  res.json({
    account,
    linkedAccountIds: linked.map((a) => a.id),
    linkedPersonIds: linked.map((a) => a.personId),
    linkedAccounts: linked.map((a) => ({ id: a.id, surface: a.surface })),
    bridge: world.graph.bridges[account.personId] ?? null
  });
});

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

start().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

export default app;
