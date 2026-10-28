import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorldState, getWorldSummary, DEFAULT_SEED } from './world/state.js';
import { advanceMinutes } from './world/activity.js';
import { sliceObservations } from './world/observations.js';
import { scanAndCount } from './world/integrity.js';
import { collectTruth } from './world/truth.js';
import { requireOperator } from './operatorAuth.js';
import type { WorldState } from './world/types.js';

const app = express();
const PORT: number = process.env.PORT ? Number(process.env.PORT) : 5173;

app.use(express.json());

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

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

getWorld(DEFAULT_SEED);

// Operator page: rewrite to the app entry so the client router takes over.
// Works in dev (Vite serves the transformed entry downstream) and in prod
// (static middleware serves dist/index.html downstream).
app.get('/world', (req, _res, next) => {
  req.url = '/index.html';
  next();
});

// Operator routes: everything except the public observations feed requires
// the operator header. truth.ts is imported here for the gated truth route
// only; the projection module cannot import it (asserted by test).
app.get('/api/world/state', requireOperator, (req, res) => {
  const seed = parseSeed(req.query.seed);
  res.json(getWorldSummary(getWorld(seed)));
});

app.get('/api/world/accounts', requireOperator, (req, res) => {
  const seed = parseSeed(req.query.seed);
  const world = getWorld(seed);
  // The console picks a list row to show in the inline drawer, and a row with
  // no sibling accounts renders an empty linked-account section. Counting the
  // person's other accounts here lets the client choose a row that has links.
  const perPerson = new Map<string, number>();
  for (const a of world.accounts) perPerson.set(a.personId, (perPerson.get(a.personId) ?? 0) + 1);
  res.json(
    world.accounts.map((a) => ({
      id: a.id,
      handle: a.handle,
      displayName: a.displayName,
      surface: a.surface,
      archetype: a.persona.archetype,
      role: a.role,
      personId: a.personId,
      linkedAccountCount: (perPerson.get(a.personId) ?? 1) - 1
    }))
  );
});

app.get('/api/world/events', requireOperator, (req, res) => {
  const seed = parseSeed(req.query.seed);
  const world = getWorld(seed);
  const n = parseNonNegativeInt(req.query.limit);
  if (n !== null) {
    res.json(n === 0 ? [] : world.events.slice(-n));
    return;
  }
  res.json(world.events);
});

app.get('/api/world/events/:id', requireOperator, (req, res) => {
  const seed = parseSeed(req.query.seed);
  const event = getWorld(seed).events.find((e) => e.id === req.params.id);
  if (!event) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(event);
});

app.get('/api/world/campaigns', requireOperator, (req, res) => {
  const seed = parseSeed(req.query.seed);
  const world = getWorld(seed);
  // The console shows the target as a handle; the campaign itself only stores
  // the person id, so resolve one of that person's accounts here.
  res.json(
    world.campaigns.map((c) => ({
      ...c,
      targetHandle: world.accounts.find((a) => a.personId === c.targetPersonId)?.handle ?? null
    }))
  );
});

app.get('/api/world/campaigns/:id', requireOperator, (req, res) => {
  const seed = parseSeed(req.query.seed);
  const campaign = getWorld(seed).campaigns.find((c) => c.id === req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(campaign);
});

app.get('/api/world/integrity', requireOperator, (req, res) => {
  const seed = parseSeed(req.query.seed);
  res.json(getWorld(seed).integrity);
});

app.get('/api/world/truth', requireOperator, (req, res) => {
  const seed = parseSeed(req.query.seed);
  res.json(collectTruth(getWorld(seed)));
});

app.post('/api/world/control', requireOperator, (req, res) => {
  const seed = parseSeed(req.query.seed);
  const minutes = (req.body as { minutes?: unknown } | undefined)?.minutes;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
    res.status(400).json({ error: 'minutes must be an integer 1..10080' });
    return;
  }
  const world = getWorld(seed);
  advanceMinutes(world, minutes);
  res.json({ seed, tick: world.tick, simulatedAt: world.simulatedAt, events: world.events.length });
});

// The account drawer shows the last few events for one account. Filtering
// server-side keeps the response small: the console never needs a page of the
// whole feed just to fill six rows.
app.get('/api/world/accounts/:id/events', requireOperator, (req, res) => {
  const seed = parseSeed(req.query.seed);
  const world = getWorld(seed);
  const id = req.params.id;
  if (!world.accounts.some((a) => a.id === id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const limit = parseNonNegativeInt(req.query.limit) ?? 12;
  const out: typeof world.events = [];
  for (let i = world.events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = world.events[i];
    if (e.actorId === id || e.targetId === id) out.push(e);
  }
  res.json(out.reverse());
});

app.get('/api/world/accounts/:id', requireOperator, (req, res) => {
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
    linkedAccounts: linked.map((a) => ({
      id: a.id,
      surface: a.surface,
      handle: a.handle,
      displayName: a.displayName
    })),
    bridge: world.graph.bridges[account.personId] ?? null
  });
});

// Public feed: cursor paging over event seq, no header required.
app.get('/api/world/observations', (req, res) => {
  const seed = parseSeed(req.query.seed);
  const world = getWorld(seed);
  const cursor = parseNonNegativeInt(req.query.cursor) ?? 0;
  const limit = parseNonNegativeInt(req.query.limit) ?? 200;
  const page = sliceObservations(world.events, cursor, limit);
  scanAndCount(world, page.observations);
  res.json(page);
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
