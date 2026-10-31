import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

// SAM 3.1 localizer transport (P9). Phrases are §4.1's five, in order. Cache
// key is sha256(image) + prompt version, on disk under
// runs/<runId>/creatives/<sha>.json alongside any mask PNGs.
//
// Two limits, stated here rather than discovered later:
// - The request path and response shape are ASSUMED (POST {base}/localize)
//   pending the §9.1a probe, which has not run: no billed call exists yet, so
//   no mask format has been observed. When the probe lands, only
//   parseLocalizeResponse changes; the cache, retry and decline contracts hold.
// - completeJson is not reused: different path, a base64 image payload, and a
//   regions envelope rather than a chat envelope. Timeout, one-5xx-retry and
//   the log line mirror it deliberately.

export const SAM_PROMPT_VERSION = 'sam.v1';

export const SAM_PHRASES = [
  'payment handle',
  'QR code',
  'contact button',
  'brand logo',
  'price or offer amount'
] as const;

export type SamPhrase = (typeof SAM_PHRASES)[number];

export interface AnchorBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnchorRegion {
  phrase: string;
  score: number;
  box: AnchorBox;
  /** Absolute path of the stored mask PNG, or null when the response carried none. */
  maskPngRef: string | null;
}

export type LocateCode =
  | 'timeout'
  | 'http_400'
  | 'http_5xx'
  | 'bad_json'
  | 'schema_mismatch'
  | 'sam_unconfigured';

export type LocateResult =
  | { ok: true; regions: AnchorRegion[]; cached: boolean }
  | { ok: false; code: LocateCode; detail: string };

export interface LocateOptions {
  runDir?: string;
  model?: string;
  promptVersion?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10000;

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function creativesDir(runDir: string): string {
  const dir = path.join(runDir, 'creatives');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseBox(value: unknown): AnchorBox | null {
  if (Array.isArray(value) && value.length === 4) {
    const [x, y, width, height] = value.map(toNumber);
    if (x === null || y === null || width === null || height === null) return null;
    if (width < 0 || height < 0) return null;
    return { x, y, width, height };
  }
  if (isRecord(value)) {
    const x = toNumber(value.x);
    const y = toNumber(value.y);
    const width = toNumber(value.width);
    const height = toNumber(value.height);
    if (x === null || y === null || width === null || height === null) return null;
    if (width < 0 || height < 0) return null;
    return { x, y, width, height };
  }
  return null;
}

interface ParsedRegion {
  phrase: string;
  score: number;
  box: AnchorBox;
  maskBase64: string | null;
}

function parseRegionsEnvelope(envelope: unknown): ParsedRegion[] | null {
  if (!isRecord(envelope) || !Array.isArray(envelope.regions)) return null;
  const out: ParsedRegion[] = [];
  for (const item of envelope.regions) {
    if (!isRecord(item)) return null;
    if (typeof item.phrase !== 'string' || item.phrase.length === 0) return null;
    const score = toNumber(item.score);
    const box = parseBox(item.box);
    if (score === null || box === null) return null;
    const mask = item.mask;
    if (mask !== undefined && mask !== null && typeof mask !== 'string') return null;
    out.push({ phrase: item.phrase, score, box, maskBase64: typeof mask === 'string' ? mask : null });
  }
  return out;
}

function readCache(runDir: string, sha: string, version: string): AnchorRegion[] | null {
  const file = path.join(runDir, 'creatives', `${sha}.json`);
  if (!fs.existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
  // A corrupt or version-skewed cache entry is a miss, never a crash: the
  // localizer is re-asked and the entry rewritten.
  if (!isRecord(parsed) || parsed.version !== version || !Array.isArray(parsed.regions)) return null;
  const out: AnchorRegion[] = [];
  for (const item of parsed.regions) {
    if (!isRecord(item)) return null;
    if (typeof item.phrase !== 'string') return null;
    const score = toNumber(item.score);
    const box = parseBox(item.box);
    if (score === null || box === null) return null;
    const ref = item.maskPngRef;
    if (ref !== null && typeof ref !== 'string') return null;
    out.push({ phrase: item.phrase, score, box, maskPngRef: ref });
  }
  return out;
}

function writeCache(runDir: string, sha: string, version: string, regions: AnchorRegion[]): void {
  const dir = creativesDir(runDir);
  fs.writeFileSync(path.join(dir, `${sha}.json`), JSON.stringify({ version, sha, regions }), 'utf8');
}

function logSam(model: string, ms: number, regions: number, cached: boolean, ok: boolean): void {
  console.log(JSON.stringify({ event: 'sam_call', model, ms, regions, cached, ok }));
}

type PostOutcome = { kind: 'responded'; status: number; text: string } | { kind: 'failed'; detail: string };

async function postOnce(
  url: string,
  key: string,
  body: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<PostOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body,
        signal: controller.signal
      }).then(
        async (res): Promise<PostOutcome> => {
          let text: string;
          try {
            text = await res.text();
          } catch (err) {
            return { kind: 'failed', detail: `body read failed: ${err instanceof Error ? err.message : String(err)}` };
          }
          return { kind: 'responded', status: res.status, text };
        },
        (err: unknown): PostOutcome => ({
          kind: 'failed',
          detail: `fetch failed: ${err instanceof Error ? err.message : String(err)}`
        })
      ),
      new Promise<PostOutcome>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ kind: 'failed', detail: `aborted after ${timeoutMs}ms` });
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function locateAnchors(image: Buffer, opts: LocateOptions = {}): Promise<LocateResult> {
  const version = opts.promptVersion ?? SAM_PROMPT_VERSION;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sha = sha256Hex(image);
  if (opts.runDir !== undefined) {
    const cached = readCache(opts.runDir, sha, version);
    if (cached !== null) {
      logSam('sam-3.1', 0, cached.length, true, true);
      return { ok: true, regions: cached, cached: true };
    }
  }
  const baseUrl = process.env.METASHIELD_BASE_URL;
  const apiKey = process.env.METASHIELD_API_KEY;
  const model = opts.model ?? process.env.METASHIELD_LOCALIZER ?? 'sam-3.1';
  // Unconfigured localizer is a decline, not an exception: the creative path
  // records its observation and returns localization_failed. completeJson
  // throws here instead, because the reasoner has no honest fallback.
  if (!baseUrl || !apiKey) {
    logSam(model, 0, 0, false, false);
    return { ok: false, code: 'sam_unconfigured', detail: 'METASHIELD_BASE_URL and METASHIELD_API_KEY must be set' };
  }
  const body = JSON.stringify({
    model,
    phrases: [...SAM_PHRASES],
    imageBase64: image.toString('base64'),
    version
  });
  const started = performance.now();
  let outcome = await postOnce(`${baseUrl}/localize`, apiKey, body, timeoutMs, fetchImpl);
  // One retry on 5xx only, mirroring the reasoner: timeouts and 4xx return.
  if (outcome.kind === 'responded' && outcome.status >= 500) {
    outcome = await postOnce(`${baseUrl}/localize`, apiKey, body, timeoutMs, fetchImpl);
  }
  const ms = Math.round(performance.now() - started);
  if (outcome.kind === 'failed') {
    logSam(model, ms, 0, false, false);
    return { ok: false, code: 'timeout', detail: outcome.detail };
  }
  if (outcome.status >= 500) {
    logSam(model, ms, 0, false, false);
    return { ok: false, code: 'http_5xx', detail: `HTTP ${outcome.status}` };
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    logSam(model, ms, 0, false, false);
    return { ok: false, code: 'http_400', detail: `HTTP ${outcome.status}` };
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(outcome.text) as unknown;
  } catch {
    logSam(model, ms, 0, false, false);
    return { ok: false, code: 'bad_json', detail: 'response body is not JSON' };
  }
  const parsed = parseRegionsEnvelope(envelope);
  if (parsed === null) {
    logSam(model, ms, 0, false, false);
    return { ok: false, code: 'schema_mismatch', detail: 'regions array missing or malformed' };
  }
  const regions: AnchorRegion[] = parsed.map((region, index) => {
    let maskPngRef: string | null = null;
    if (region.maskBase64 !== null && opts.runDir !== undefined) {
      const dir = creativesDir(opts.runDir);
      const file = path.join(dir, `${sha}-${index}.png`);
      fs.writeFileSync(file, Buffer.from(region.maskBase64, 'base64'));
      maskPngRef = file;
    }
    return { phrase: region.phrase, score: region.score, box: region.box, maskPngRef };
  });
  if (opts.runDir !== undefined) writeCache(opts.runDir, sha, version, regions);
  logSam(model, ms, regions.length, false, true);
  return { ok: true, regions, cached: false };
}
