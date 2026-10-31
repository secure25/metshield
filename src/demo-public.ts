import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_SEED, printResult, runPublicDemo } from './harness.js';

// npm run demo:public — the feed-only run. No world code is loaded; a fixture
// blocklist over loopback HTTP plus fixed submissions must yield a confirmed,
// attributed card with zero synthetic observations, or the script fails.

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
  const result = await runPublicDemo({ seed, rootDir: path.resolve('runs'), feedBody });
  printResult(result);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
