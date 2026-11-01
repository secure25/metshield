// SAM 3.1 localizer transport (P9, rewired post-probe). One unary call per
// noun phrase to POST {base}/responses — model sam-3.1, input_text phrase +
// input_image data URL, metadata asks for confidence — and the response is the
// SAM 3 text grammar in one output_text lane: `<0f>id<|box;...|><|mask;...|>`.
//
// Three deliberate limits, stated here rather than discovered later:
// - Boxes are parsed; mask payloads are kept as opaque strings. Raster-decoding
//   the base85 arithmetic-coded payload is a separate project, and the crop,
//   the overlay artifact and the join key all run on the box. FOROS (a fellow
//   hackathon project on this API) parses boxes the same way.
// - Video is out of scope: only frame-0 records are kept.
// - SVG creatives are sent with an image/svg+xml data URL and left to the
//   server; raster input (PNG/JPEG) is the tested path.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const SAM_PROMPT_VERSION = 'sam.v2';

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
  /** Box token's confidence, or null when the model returned none. */
  score: number | null;
  /** Half-open pixels derived from the inclusive grammar box. */
  box: AnchorBox;
  objectId: string;
  /** w,h the model reported for the media. */
  sourceDims: { width: number; height: number };
  /** Raw mask payload string; raster decode is not implemented. */
  maskPayload: string | null;
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
  /** Noun phrases to localize; defaults to SAM_PHRASES. Part of the cache key. */
  phrases?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 25000;

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sniffMime(image: Buffer): string {
  if (image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (image.length >= 2 && image[0] === 0xff && image[1] === 0xd8) return 'image/jpeg';
  const head = image.subarray(0, 200).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

export interface SamRequest {
  model: string;
  input: Array<{
    type: 'message';
    role: 'user';
    content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }>;
  }>;
  metadata: { include_confidence: 'true' };
  store: false;
}

export function buildSamRequest(model: string, phrase: string, imageDataUrl: string): SamRequest {
  return {
    model,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: phrase },
          { type: 'input_image', image_url: imageDataUrl }
        ]
      }
    ],
    metadata: { include_confidence: 'true' },
    store: false
  };
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

function parseAnchorBox(value: unknown): AnchorBox | null {
  if (!isRecord(value)) return null;
  const x = toNumber(value.x);
  const y = toNumber(value.y);
  const width = toNumber(value.width);
  const height = toNumber(value.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width < 0 || height < 0) return null;
  return { x, y, width, height };
}

// --- SAM 3 text grammar (images only) --------------------------------------
// `<0f>0<|box;x1=10;y1=20;x2=14;y2=24;w=100;h=80;c=0.75|><|mask;x=0;y=0;data=…|>`
// Box coords are inclusive source pixels; masks are opaque payload strings.
// Malformed records are skipped, never thrown: a partial lane still localizes.
// Mask `data` keeps its commas and semicolons verbatim — fields split on ';'
// only at the first one after the token name, and nothing downstream re-splits.

export interface SamRecord {
  objectId: string;
  box: AnchorBox;
  sourceDims: { width: number; height: number };
  score: number | null;
  maskPayload: string | null;
}

function parseFields(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.split(';')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

function parseIntField(fields: Map<string, string>, key: string, signed: boolean): number | null {
  const raw = fields.get(key);
  if (raw === undefined || !/^-?\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) return null;
  if (!signed && value < 0) return null;
  return value;
}

function parseConfidence(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return value === 0 ? 0 : value;
}

function parseSegment(segment: string): Omit<SamRecord, 'score'> & { score: number | null } | null {
  const idMatch = /^(\d+)(<\|.*)$/s.exec(segment);
  if (idMatch === null) return null;
  const objectId = idMatch[1];
  const tokenText = idMatch[2];
  const tokens: Array<{ name: string; fields: Map<string, string> }> = [];
  const tokenPattern = /<\|(.*?)\|>/gs;
  let match: RegExpExecArray | null;
  let consumed = '';
  while ((match = tokenPattern.exec(tokenText)) !== null) {
    consumed += match[0];
    const inner = match[1];
    const semi = inner.indexOf(';');
    const name = (semi === -1 ? inner : inner.slice(0, semi)).trim();
    const fields = semi === -1 ? new Map<string, string>() : parseFields(inner.slice(semi + 1));
    tokens.push({ name, fields });
  }
  // Text between tokens that is not a token makes the record malformed.
  if (consumed !== tokenText) return null;
  const box = tokens.find((token) => token.name === 'box');
  const mask = tokens.find((token) => token.name === 'mask');
  if (box === undefined || mask === undefined) return null;
  const x1 = parseIntField(box.fields, 'x1', true);
  const y1 = parseIntField(box.fields, 'y1', true);
  const x2 = parseIntField(box.fields, 'x2', true);
  const y2 = parseIntField(box.fields, 'y2', true);
  const w = parseIntField(box.fields, 'w', false);
  const h = parseIntField(box.fields, 'h', false);
  const data = mask.fields.get('data');
  if (x1 === null || y1 === null || x2 === null || y2 === null || w === null || h === null || w <= 0 || h <= 0) return null;
  if (data === undefined || data.length === 0) return null;
  if (x1 > x2 || y1 > y2) return null;
  if (x1 < 0 || y1 < 0 || x2 >= w || y2 >= h) return null;
  return {
    objectId,
    box: { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 },
    sourceDims: { width: w, height: h },
    score: parseConfidence(box.fields.get('c')),
    maskPayload: data
  };
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

// Records inside a frame are separated by a comma, but a comma is NOT a safe
// split point: the mask payload is a base85 stream whose alphabet includes ','
// and ';' (the spec example alone contains `data=5,5,!!!!!(QO(0lu8?`). Splitting
// on it cuts a mask in half and drops the box with it. So scan structurally: a
// record is digits followed by one or more complete `<|name;...|>` tokens, and
// the lane ends at the first thing that is not a record, so trailing prose is
// dropped rather than coerced into one.
function splitFrameRecords(body: string): string[] {
  const segments: string[] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && (body[i] === ',' || /\s/.test(body[i]))) i += 1;
    if (i >= body.length) break;
    const start = i;
    while (i < body.length && isDigit(body[i])) i += 1;
    if (i === start) break;
    if (!body.startsWith('<|', i)) break;
    let tokens = 0;
    while (body.startsWith('<|', i)) {
      // '|>' terminates a token. A mask payload that itself contained '|>' would
      // end early; the box still parses, so the record degrades rather than throws.
      const end = body.indexOf('|>', i + 2);
      if (end === -1) return segments;
      i = end + 2;
      tokens += 1;
    }
    if (tokens === 0) break;
    segments.push(body.slice(start, i));
  }
  return segments;
}

export function parseSamOutputText(text: string): SamRecord[] {
  const out: SamRecord[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const frame = /^<(\d+)f>(.*)$/s.exec(line);
    if (frame === null) continue;
    // Images only: frame 0 carries the records; anything else is video.
    if (frame[1] !== '0') continue;
    for (const segment of splitFrameRecords(frame[2])) {
      const record = parseSegment(segment);
      if (record !== null) out.push(record);
    }
  }
  return out;
}

/** Collects every output_text part from a unary Responses envelope. */
export function extractOutputTexts(envelope: unknown): string[] | null {
  if (!isRecord(envelope) || !Array.isArray(envelope.output)) return null;
  const out: string[] = [];
  for (const item of envelope.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') out.push(part.text);
    }
  }
  return out;
}

interface CacheEntry {
  phrases: string[];
  regions: AnchorRegion[];
}

function readCache(runDir: string, sha: string, version: string, phrases: readonly string[]): AnchorRegion[] | null {
  const file = path.join(runDir, 'creatives', `${sha}.json`);
  if (!fs.existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
  // A corrupt, version-skewed or phrase-skewed entry is a miss, never a
  // crash: the localizer is re-asked and the entry rewritten.
  if (!isRecord(parsed) || parsed.version !== version) return null;
  const entry = parsed as { phrases?: unknown; regions?: unknown };
  if (!Array.isArray(entry.phrases) || !Array.isArray(entry.regions)) return null;
  const want = [...phrases];
  const have = entry.phrases;
  if (have.length !== want.length || !have.every((phrase, index) => phrase === want[index])) return null;
  const out: AnchorRegion[] = [];
  for (const item of entry.regions) {
    if (!isRecord(item) || typeof item.phrase !== 'string' || typeof item.objectId !== 'string') return null;
    const box = parseAnchorBox(item.box);
    const dims = item.sourceDims;
    const score = item.score;
    const payload = item.maskPayload;
    if (box === null || !isRecord(dims)) return null;
    const width = toNumber(dims.width);
    const height = toNumber(dims.height);
    if (width === null || height === null) return null;
    if (score !== null && toNumber(score) === null) return null;
    if (payload !== null && typeof payload !== 'string') return null;
    out.push({
      phrase: item.phrase,
      score: score === null ? null : (score as number),
      box,
      objectId: item.objectId,
      sourceDims: { width, height },
      maskPayload: payload === null ? null : (payload as string)
    });
  }
  return out;
}

function writeCache(runDir: string, sha: string, version: string, entry: CacheEntry): void {
  const dir = creativesDir(runDir);
  fs.writeFileSync(path.join(dir, `${sha}.json`), JSON.stringify({ version, sha, ...entry }), 'utf8');
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
  const phrases = [...(opts.phrases ?? SAM_PHRASES)];
  const sha = sha256Hex(image);
  if (opts.runDir !== undefined) {
    const cached = readCache(opts.runDir, sha, version, phrases);
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
  const dataUrl = `data:${sniffMime(image)};base64,${image.toString('base64')}`;
  const started = performance.now();
  const regions: AnchorRegion[] = [];
  // One phrase per request: input_text carries a single noun phrase, and a
  // request must not combine phrases. Sequential: rate-limit friendly, and a
  // failure aborts the run rather than returning a partial phrase set.
  for (const phrase of phrases) {
    const body = JSON.stringify(buildSamRequest(model, phrase, dataUrl));
    let outcome = await postOnce(`${baseUrl}/responses`, apiKey, body, timeoutMs, fetchImpl);
    // One retry on 5xx only, mirroring the reasoner: timeouts and 4xx return.
    if (outcome.kind === 'responded' && outcome.status >= 500) {
      outcome = await postOnce(`${baseUrl}/responses`, apiKey, body, timeoutMs, fetchImpl);
    }
    if (outcome.kind === 'failed') {
      const ms = Math.round(performance.now() - started);
      logSam(model, ms, 0, false, false);
      return { ok: false, code: 'timeout', detail: outcome.detail };
    }
    if (outcome.status >= 500) {
      const ms = Math.round(performance.now() - started);
      logSam(model, ms, 0, false, false);
      return { ok: false, code: 'http_5xx', detail: `HTTP ${outcome.status}` };
    }
    if (outcome.status < 200 || outcome.status >= 300) {
      const ms = Math.round(performance.now() - started);
      logSam(model, ms, 0, false, false);
      return { ok: false, code: 'http_400', detail: `HTTP ${outcome.status}` };
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(outcome.text) as unknown;
    } catch {
      const ms = Math.round(performance.now() - started);
      logSam(model, ms, 0, false, false);
      return { ok: false, code: 'bad_json', detail: 'response body is not JSON' };
    }
    const texts = extractOutputTexts(envelope);
    if (texts === null) {
      const ms = Math.round(performance.now() - started);
      const keys = isRecord(envelope) ? Object.keys(envelope).slice(0, 8).join(',') : 'non-object';
      logSam(model, ms, 0, false, false);
      return { ok: false, code: 'schema_mismatch', detail: `no output array in unary response (keys: ${keys})` };
    }
    for (const record of parseSamOutputText(texts.join('\n'))) {
      regions.push({ phrase, score: record.score, box: record.box, objectId: record.objectId, sourceDims: record.sourceDims, maskPayload: record.maskPayload });
    }
  }
  const ms = Math.round(performance.now() - started);
  if (opts.runDir !== undefined) writeCache(opts.runDir, sha, version, { phrases, regions });
  logSam(model, ms, regions.length, false, true);
  return { ok: true, regions, cached: false };
}
