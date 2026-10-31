import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import app from './server.js';
import {
  DEMO_SEED,
  WORLD_ADVANCE_MINUTES,
  WORLD_BATCH_LIMIT,
  collectWorldBatch,
  printResult,
  runWorldScenario
} from './harness.js';

// npm run demo:world — the Living World run. The app boots in-process on an
// ephemeral port, a seeded world advances into campaign territory, and the
// harness polls its real observation feed over HTTP, derives submissions from
// observed links, and reports. The world is touched over HTTP only — this
// file imports no world code, and the boundary test enforces that.

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseSeed(raw: string | undefined): number {
  if (raw === undefined) return DEMO_SEED;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`invalid seed ${raw}`);
  return parsed;
}

async function main(): Promise<void> {
  const seed = parseSeed(process.argv[2]);
  const feedBody = fs.readFileSync(path.join(HERE, '..', 'fixtures', 'feeds', 'example-blocklist.txt'), 'utf8');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  try {
    const batch = await collectWorldBatch(
      `http://127.0.0.1:${address.port}`,
      seed,
      WORLD_ADVANCE_MINUTES,
      WORLD_BATCH_LIMIT
    );
    const result = await runWorldScenario(batch, { seed, rootDir: path.resolve('runs'), feedBody });
    printResult(result);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
