// Model probe (§9.1a). Makes real billed calls through the product's own
// transports — completeJson and locateAnchors — so a green probe means the
// shipped code paths work, not a parallel script. Run from metshield/ with
// METASHIELD_BASE_URL and METASHIELD_API_KEY set; results go to
// runs/model-probe.json (gitignored). The key is never printed or written.
//
// Known limits of this probe, stated up front:
// - completeJson/locateAnchors retry once on 5xx; that product behavior comes
//   along, so "one call per model" means one call plus the shipped retry.
// - Transports surface usage + latency but not response headers or the echoed
//   model id, so tier/rate-limit answers are partial unless the body carries
//   them. No product change is made for this until the probe shows the need.
// - The demo-sized cluster is realistic (3 surfaces, 6 indicators), not forced
//   to 1.5k tokens; the report records measured input tokens instead.
// - Step 1b spends two small calls testing reasoning-effort spellings, because
//   run one showed 3420 output tokens for ~150 tokens of proposal: reasoning
//   dominates latency, and the winner is baked into the reasoner default.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { z } from 'zod';
import { completeJson } from '../src/models/client.js';
import { MUSE_DEFAULT_MODEL, proposeCard } from '../src/models/muse.js';
import { locateAnchors } from '../src/models/sam.js';
import type { Cluster } from '../src/correlate.js';
import type { StoredIndicator } from '../src/store.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FIXTURE_WIDTH = 512;
const FIXTURE_HEIGHT = 512;
const DEMO_BUDGET_MS = 4000;

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

// Deterministic 512x512 RGB fixture: dark field, one gold band, one light
// rectangle inside it. Fixed bytes for fixed dims — no font, no assets.
export function generateProbePng(width: number = FIXTURE_WIDTH, height: number = FIXTURE_HEIGHT): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3, 0);
    const inBand = y >= 300 && y < 372;
    for (let x = 0; x < width; x += 1) {
      const inRect = inBand && x >= 96 && x < 416;
      const o = 1 + x * 3;
      if (inRect) {
        row[o] = 232;
        row[o + 1] = 226;
        row[o + 2] = 208;
      } else if (inBand) {
        row[o] = 196;
        row[o + 1] = 164;
        row[o + 2] = 64;
      } else {
        row[o] = 30;
        row[o + 1] = 32;
        row[o + 2] = 40;
      }
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

export function verifyPng(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median of no values');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type CoordSpace = 'pixels' | 'normalized' | 'indeterminate';

export function coordSpaceOf(
  boxes: Array<{ x: number; y: number; width: number; height: number }>,
  imageWidth: number,
  imageHeight: number
): CoordSpace {
  if (boxes.length === 0) return 'indeterminate';
  const flat = boxes.flatMap((box) => [box.x, box.y, box.width, box.height]);
  if (flat.every((value) => value >= 0 && value <= 1)) return 'normalized';
  const inPixels = boxes.every(
    (box) => box.x >= 0 && box.y >= 0 && box.x + box.width <= imageWidth && box.y + box.height <= imageHeight
  );
  return inPixels ? 'pixels' : 'indeterminate';
}

// Realistic corroborated-shape fixture: 3 surfaces, 6 observations worth of
// per-surface counts, 6 indicators in 4 families. Fixed strings, fixed times.
export function fixtureCluster(): Cluster {
  return {
    id: 'CLU-PROBE-01',
    indicatorIds: ['IND-PROBE-01', 'IND-PROBE-02', 'IND-PROBE-03', 'IND-PROBE-04', 'IND-PROBE-05', 'IND-PROBE-06'],
    surfaces: ['facebook', 'messenger', 'whatsapp'],
    observationIds: ['obs-p1', 'obs-p2', 'obs-p3', 'obs-p4', 'obs-p5', 'obs-p6'],
    familyCount: 4,
    claimCodes: ['advance_fee_request', 'urgency'],
    firstSeenAt: '2026-06-10T10:00:00.000Z',
    lastSeenAt: '2026-06-10T10:47:00.000Z',
    perSurfaceCounts: { facebook: 2, messenger: 3, whatsapp: 1 },
    syntheticAll: false,
    tierInputs: {
      crossSurfacePairs: [
        ['facebook', 'messenger'],
        ['messenger', 'whatsapp']
      ],
      families: ['domain', 'payment_handle', 'phone', 'page_ref'],
      hasConfirmedIndicator: false
    }
  };
}

export function fixtureIndicators(): StoredIndicator[] {
  const at = (day: string): string => `2026-06-10T${day}:00.000Z`;
  const make = (
    id: string,
    indicator: StoredIndicator['indicator'],
    seen: string
  ): StoredIndicator => ({
    id,
    indicator,
    firstSeenAt: at('10:00'),
    lastSeenAt: at(seen),
    observationIds: [`obs-${id.slice(-2).toLowerCase()}`],
    expiresAt: '2026-07-10T10:00:00.000Z'
  });
  return [
    make('IND-PROBE-01', { family: 'domain', canonical: 'offer.example', display: 'offer.example', registrable: 'offer.example' }, '10:12'),
    make('IND-PROBE-02', { family: 'domain', canonical: 'pay.offer.example', display: 'pay.offer.example', registrable: 'offer.example' }, '10:20'),
    make('IND-PROBE-03', { family: 'payment_handle', canonical: 'desk.offer.example', display: '@Desk.Offer.Example', variant: '@Desk.Offer.Example' }, '10:31'),
    make('IND-PROBE-04', { family: 'phone', canonical: '+10005550142', display: '+1 000-555-0142', suffix: '550142' }, '10:35'),
    make('IND-PROBE-05', { family: 'page_ref', canonical: 'PAGE-PROBE-01', display: 'PAGE-PROBE-01' }, '10:40'),
    make('IND-PROBE-06', { family: 'domain', canonical: 'offer.example', display: 'offer.example', registrable: 'offer.example' }, '10:47')
  ];
}

interface CallRecord {
  ok: boolean;
  code: string | null;
  detail: string | null;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  data: unknown;
}

interface ProbeReport {
  generatedAt: string;
  baseUrlHost: string;
  reasonerModel: string;
  localizerModel: string;
  reasonerSmall: CallRecord;
  reasoningTests: Array<{ name: string; extra: Record<string, unknown>; record: CallRecord }>;
  reasonerDemo: { runs: CallRecord[]; medianMs: number; budgetMs: number; fitsBudget: boolean };
  localizer: {
    fixture: { path: string; sha256: string; width: number; height: number; generated: boolean };
    phrases: string[];
    ok: boolean;
    code: string | null;
    detail: string | null;
    regionCount: number;
    regions: Array<{
      phrase: string;
      score: number | null;
      box: { x: number; y: number; width: number; height: number };
      objectId: string;
      sourceDims: { width: number; height: number };
      hasMaskPayload: boolean;
      maskPayloadChars: number;
    }>;
    coordSpace: CoordSpace;
    cropRoundTrip: string;
  };
  credits: {
    grantLive: boolean;
    tier: string | null;
    tierNote: string;
    rateLimits: string | null;
    rateLimitNote: string;
  };
  answers: {
    keyAuthenticates: boolean;
    reasonerModelExists: boolean;
    localizerModelExists: boolean;
    jsonSchemaAccepted: boolean;
    reasoningParam: string;
    maskForm: string;
    demoFitsBudget: boolean;
    grantLive: boolean;
  };
}

const SMALL_SCHEMA = z.object({ decision: z.enum(['emit', 'decline']), confidence: z.number() });

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unparseable-base-url';
  }
}

function ensureFixtureImage(): { path: string; bytes: Buffer; generated: boolean } {
  const override = process.env.PROBE_IMAGE;
  if (override !== undefined && override.length > 0) {
    const bytes = fs.readFileSync(override);
    const dims = verifyPng(bytes);
    if (dims === null) throw new Error(`PROBE_IMAGE is not a PNG: ${override}`);
    return { path: override, bytes, generated: false };
  }
  const file = path.join('fixtures', 'probe', 'probe-creative.png');
  if (fs.existsSync(file)) {
    const bytes = fs.readFileSync(file);
    if (verifyPng(bytes) === null) throw new Error(`committed fixture is not a PNG: ${file}`);
    return { path: file, bytes, generated: false };
  }
  const bytes = generateProbePng();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return { path: file, bytes, generated: true };
}

async function main(): Promise<void> {
  const baseUrl = process.env.METASHIELD_BASE_URL;
  const apiKey = process.env.METASHIELD_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('METASHIELD_BASE_URL and METASHIELD_API_KEY must be set (the key is never printed or written)');
  }
  const localizerModel = process.env.METASHIELD_LOCALIZER ?? 'sam-3.1';

  // Ensured up front (not in the SAM section) so the log names the fixture
  // before any billed call: a rerun in a fresh shell without PROBE_IMAGE set
  // silently falls back to the generated pattern otherwise.
  const fixture = ensureFixtureImage();
  const fixtureDims = verifyPng(fixture.bytes) ?? { width: 0, height: 0 };
  console.log(
    JSON.stringify({
      event: 'probe_fixture',
      path: fixture.path,
      sha256: sha256Hex(fixture.bytes),
      width: fixtureDims.width,
      height: fixtureDims.height
    })
  );

  const small = await completeJson({
    model: MUSE_DEFAULT_MODEL,
    messages: [
      { role: 'system', content: 'Reply with a JSON object only.' },
      { role: 'user', content: 'Should a warning be emitted for weak evidence? Answer decline with confidence 0.1.' }
    ],
    schema: SMALL_SCHEMA,
    schemaName: 'probe_small',
    temperature: 0.2,
    timeoutMs: 30000
  });
  const reasonerSmall: CallRecord =
    small.ok
      ? { ok: true, code: null, detail: null, ms: small.ms, inputTokens: small.usage.inputTokens, outputTokens: small.usage.outputTokens, data: small.data }
      : { ok: false, code: small.code, detail: small.detail, ms: 0, inputTokens: 0, outputTokens: 0, data: null };

  const reasoningTests: Array<{ name: string; extra: Record<string, unknown>; record: CallRecord }> = [];
  for (const candidate of [
    { name: 'reasoning_effort', extra: { reasoning_effort: 'minimal' } },
    { name: 'reasoning.effort', extra: { reasoning: { effort: 'minimal' } } }
  ]) {
    const attempt = await completeJson({
      model: MUSE_DEFAULT_MODEL,
      messages: [
        { role: 'system', content: 'Reply with a JSON object only.' },
        { role: 'user', content: 'Should a warning be emitted for weak evidence? Answer decline with confidence 0.1.' }
      ],
      schema: SMALL_SCHEMA,
      schemaName: 'probe_small',
      temperature: 0.2,
      timeoutMs: 60000,
      extra: candidate.extra
    });
    reasoningTests.push({
      name: candidate.name,
      extra: candidate.extra,
      record: attempt.ok
        ? { ok: true, code: null, detail: null, ms: attempt.ms, inputTokens: attempt.usage.inputTokens, outputTokens: attempt.usage.outputTokens, data: attempt.data }
        : { ok: false, code: attempt.code, detail: attempt.detail, ms: 0, inputTokens: 0, outputTokens: 0, data: null }
    });
  }

  const cluster = fixtureCluster();
  const indicators = fixtureIndicators();
  const demoRuns: CallRecord[] = [];
  for (let i = 0; i < 3; i += 1) {
    const attempt = await proposeCard(cluster, { indicators, timeoutMs: 90000 });
    demoRuns.push(
      attempt.ok
        ? { ok: true, code: null, detail: null, ms: attempt.ms, inputTokens: attempt.usage.inputTokens, outputTokens: attempt.usage.outputTokens, data: attempt.data }
        : { ok: false, code: attempt.code, detail: attempt.detail, ms: 0, inputTokens: 0, outputTokens: 0, data: null }
    );
  }
  const demoMs = demoRuns.filter((run) => run.ok).map((run) => run.ms);
  const medianMs = demoMs.length > 0 ? median(demoMs) : -1;

  const runDir = path.join('runs', 'model-probe');
  fs.mkdirSync(runDir, { recursive: true });
  const probePhrases = (process.env.PROBE_PHRASES ?? 'payment handle')
    .split(',')
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);
  const located = await locateAnchors(fixture.bytes, { runDir, phrases: probePhrases.length > 0 ? probePhrases : ['payment handle'] });
  const regions = located.ok
    ? located.regions.map((region) => ({
        phrase: region.phrase,
        score: region.score,
        box: region.box,
        objectId: region.objectId,
        sourceDims: region.sourceDims,
        hasMaskPayload: region.maskPayload !== null,
        maskPayloadChars: region.maskPayload?.length ?? 0
      }))
    : [];
  const coordSpace = located.ok ? coordSpaceOf(regions.map((region) => region.box), fixtureDims.width, fixtureDims.height) : 'indeterminate';
  let cropRoundTrip: string;
  if (!located.ok) {
    cropRoundTrip = `untested: localizer call failed (${located.code}: ${located.detail})`;
  } else if (regions.length === 0) {
    cropRoundTrip = 'empty lane parsed: call succeeded with zero records, which is valid (no matches)';
  } else {
    const largest = [...regions].sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0];
    const nonEmpty = largest.box.width > 0 && largest.box.height > 0;
    const dims = largest.sourceDims;
    const dimsMatch = dims.width === fixtureDims.width && dims.height === fixtureDims.height;
    const inBounds =
      largest.box.x >= 0 && largest.box.y >= 0 && largest.box.x + largest.box.width <= dims.width && largest.box.y + largest.box.height <= dims.height;
    cropRoundTrip =
      nonEmpty && inBounds
        ? `passed: largest box (${largest.phrase}) is non-empty and in-bounds of reported ${dims.width}x${dims.height} (fixture is ${fixtureDims.width}x${fixtureDims.height}: ${dimsMatch ? 'match' : 'MISMATCH'})`
        : `FAILED: largest box (${largest.phrase}) is empty or out-of-bounds of reported ${dims.width}x${dims.height}`;
  }

  const keyAuthenticates = reasonerSmall.ok || (reasonerSmall.code !== 'http_400' && reasonerSmall.code !== 'timeout');
  const grantLive = demoRuns.some((run) => run.ok) || reasonerSmall.ok;
  const maskForm = !located.ok
    ? `unknown: call failed (${located.code})`
    : regions.length === 0
      ? 'grammar lane parsed, zero records (empty lane is valid: no matches)'
      : 'SAM 3 grammar records: boxes parsed to half-open pixels, mask payloads kept as opaque strings (raster decode not implemented)';

  const report: ProbeReport = {
    generatedAt: new Date().toISOString(),
    baseUrlHost: hostOf(baseUrl),
    reasonerModel: MUSE_DEFAULT_MODEL,
    localizerModel,
    reasonerSmall,
    reasoningTests,
    reasonerDemo: { runs: demoRuns, medianMs, budgetMs: DEMO_BUDGET_MS, fitsBudget: medianMs >= 0 && medianMs <= DEMO_BUDGET_MS },
    localizer: {
      fixture: { path: fixture.path, sha256: sha256Hex(fixture.bytes), width: fixtureDims.width, height: fixtureDims.height, generated: fixture.generated },
      phrases: probePhrases.length > 0 ? probePhrases : ['payment handle'],
      ok: located.ok,
      code: located.ok ? null : located.code,
      detail: located.ok ? null : located.detail,
      regionCount: regions.length,
      regions,
      coordSpace,
      cropRoundTrip
    },
    credits: {
      grantLive,
      tier: null,
      tierNote: 'not surfaced: transports return usage + latency, not tier strings or headers',
      rateLimits: null,
      rateLimitNote: 'not surfaced: transports return usage + latency, not rate-limit headers'
    },
    answers: {
      keyAuthenticates,
      reasonerModelExists: reasonerSmall.ok || reasonerSmall.detail !== 'HTTP 404',
      localizerModelExists: located.ok || (located.ok === false && located.detail !== 'HTTP 404'),
      jsonSchemaAccepted: reasonerSmall.ok,
      reasoningParam: !reasonerSmall.ok
        ? 'untested (baseline failed)'
        : (reasoningTests.find((test) => test.name === 'reasoning_effort')?.record.ok ?? false)
          ? 'reasoning_effort'
          : (reasoningTests.find((test) => test.name === 'reasoning.effort')?.record.ok ?? false)
            ? 'reasoning.effort'
            : 'neither (both rejected)',
      maskForm,
      demoFitsBudget: medianMs >= 0 && medianMs <= DEMO_BUDGET_MS,
      grantLive
    }
  };
  fs.mkdirSync('runs', { recursive: true });
  fs.writeFileSync(path.join('runs', 'model-probe.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ event: 'probe_done', report: path.join('runs', 'model-probe.json'), answers: report.answers }));
}

// Guarded: importing this module (unit tests import the pure helpers) must
// not bill calls or set the process exit code.
const probeEntryHref = process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href;
if (probeEntryHref !== null && probeEntryHref === import.meta.url) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: 'probe_failed', detail: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
