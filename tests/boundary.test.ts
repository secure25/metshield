import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function specifiersOf(source: string): string[] {
  const out: string[] = [];
  // Static specifiers only: from/import/dynamic-import/side-effect. A dynamic
  // import() of a variable cannot be grepped; none exists in this tree.
  const re = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

function importsWorld(spec: string): boolean {
  return /(^|[/])world(\/|$)/.test(spec);
}

// Hosts, not product code: the server that mounts both sides, its auth, the
// shared contract, the fixture itself, and the fixture's console (which shows
// world creatives). Everything else is product code and must not reach in.
function isExempt(rel: string): boolean {
  if (rel === 'server.ts' || rel === 'operatorAuth.ts' || rel === 'contract.ts') return true;
  return rel.startsWith('world/') || rel.startsWith('console/');
}

describe('boundary', () => {
  it('lets no product file import from src/world', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const rel = path.relative(SRC, file).replace(/\\/g, '/');
      if (isExempt(rel)) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (specifiersOf(src).some(importsWorld)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the contract the one shared seam', () => {
    const contractSrc = fs.readFileSync(path.join(SRC, 'contract.ts'), 'utf8');
    expect(specifiersOf(contractSrc)).toEqual([]);
    const definitions: string[] = [];
    let detectorMentions = 0;
    for (const file of tsFiles(SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      if (/\binterface\s+Observation\b/.test(src)) {
        definitions.push(path.relative(SRC, file).replace(/\\/g, '/'));
      }
      if (src.includes('DetectorEvent')) detectorMentions++;
    }
    expect(definitions).toEqual(['contract.ts']);
    expect(detectorMentions).toBe(0);
  });
});
