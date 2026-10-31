import fs from 'node:fs';
import path from 'node:path';
import type { Indicator, ObservationSurface } from '../contract.js';
import type { AnchorBox } from '../models/sam.js';
import { locateAnchors, sha256Hex } from '../models/sam.js';
import type { Card } from '../cards.js';
import type { Pipeline, SubmissionResult } from '../pipeline.js';

// Submission connector (P9): both user-submission paths live here. The link
// path is a one-line front for pipeline.submitLink — P8 built and proved it,
// so it is not rewritten. The creative path is new: hash → cache → SAM →
// extract → normalise → store → correlate → card, declining (never erroring)
// at every failure.
//
// OCR choice, as the phase asks: there is none for raster images. No native
// dependency and no traineddata download belong in this phase, so masked
// regions over PNG/JPEG record their boxes and extract nothing, and the
// observation declines on evidence rather than erroring on tooling. What IS
// real is vector-text extraction: SVG creatives carry <text> nodes, and
// extractSvgText reads the ones whose anchor falls inside a mask box —
// deterministic, zero dependencies, and exactly the W7 creative shape.

// Value classification P8's looksLinky grew into: URL-ish goes to
// offplatform_link (routeWorldIndicator splits domains from phone-likes), and
// phone-like digit strings join it so they normalise to the phone family
// instead of misfiling as handles. Everything else is a handle.
export function classifySubmissionValue(value: string): 'offplatform_link' | 'payment_handle' {
  const trimmed = value.trim();
  if (/:\/\//.test(trimmed) || trimmed.toLowerCase().startsWith('www.')) return 'offplatform_link';
  if (/^[+\d]/.test(trimmed) && trimmed.replace(/\D/g, '').length >= 7) return 'offplatform_link';
  if (trimmed.startsWith('@') || /\s/.test(trimmed)) return 'payment_handle';
  return trimmed.includes('.') ? 'offplatform_link' : 'payment_handle';
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ParsedImageFile {
  fieldName: string;
  filename: string;
  mime: string;
  data: Buffer;
}

export type MultipartCode =
  | 'content_type_invalid'
  | 'boundary_missing'
  | 'file_missing'
  | 'file_too_large'
  | 'image_empty';

export type MultipartResult =
  | { ok: true; file: ParsedImageFile; fields: Map<string, string> }
  | { ok: false; code: MultipartCode };

// Minimal single-file multipart parser, hand-rolled so the phase adds no
// dependency: first part carrying a filename wins, text fields collected
// alongside. Strict CRLF with an LF fallback; RFC 5987 filename* ignored.
export function parseMultipartImage(body: Buffer, contentType: string | undefined): MultipartResult {
  if (typeof contentType !== 'string' || !contentType.toLowerCase().includes('multipart/form-data')) {
    return { ok: false, code: 'content_type_invalid' };
  }
  const match = /boundary=(?:"([^"]+)"|([^;,\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return { ok: false, code: 'boundary_missing' };
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = new Map<string, string>();
  let file: ParsedImageFile | null = null;
  let start = body.indexOf(delimiter, 0);
  while (start !== -1) {
    let cursor = start + delimiter.length;
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) break;
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2;
    else if (body[cursor] === 0x0a) cursor += 1;
    let headerEnd = body.indexOf('\r\n\r\n', cursor);
    let sepLen = 4;
    if (headerEnd === -1) {
      headerEnd = body.indexOf('\n\n', cursor);
      sepLen = 2;
    }
    if (headerEnd === -1) break;
    const headerText = body.subarray(cursor, headerEnd).toString('latin1');
    const dataStart = headerEnd + sepLen;
    const next = body.indexOf(delimiter, dataStart);
    if (next === -1) break;
    let dataEnd = next;
    if (body[dataEnd - 2] === 0x0d && body[dataEnd - 1] === 0x0a) dataEnd -= 2;
    else if (body[dataEnd - 1] === 0x0a) dataEnd -= 1;
    const data = body.subarray(dataStart, dataEnd);
    const disp = /content-disposition:\s*form-data;\s*name="([^"]*)"(?:;\s*filename="([^"]*)")?/i.exec(headerText);
    if (disp) {
      const name = disp[1] ?? '';
      const filename = disp[2];
      if (filename !== undefined) {
        if (file === null) {
          const mimeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerText);
          file = {
            fieldName: name,
            filename,
            mime: (mimeMatch?.[1] ?? 'application/octet-stream').trim().toLowerCase(),
            data: Buffer.from(data)
          };
        }
      } else if (!fields.has(name)) {
        fields.set(name, data.toString('utf8'));
      }
    }
    start = next;
  }
  if (file === null) return { ok: false, code: 'file_missing' };
  if (file.data.length > MAX_IMAGE_BYTES) return { ok: false, code: 'file_too_large' };
  if (file.data.length === 0) return { ok: false, code: 'image_empty' };
  return { ok: true, file, fields };
}

const SVG_OPEN = /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/;

function firstNumber(attr: string | null): number | null {
  if (attr === null) return null;
  const match = /-?\d+(?:\.\d+)?/.exec(attr);
  return match === null ? null : Number(match[0]);
}

// Vector-text extraction: the <text> nodes whose (x, y) anchor falls inside
// the mask box. Non-SVG bytes yield nothing — that is the documented raster
// gap, not a parse failure.
export function extractSvgText(svg: Buffer, box: AnchorBox): string[] {
  const text = svg.toString('utf8');
  if (!SVG_OPEN.test(text)) return [];
  const out: string[] = [];
  const nodes = /<text\b([^>]*)>([^<]*)<\/text\s*>/gi;
  let found: RegExpExecArray | null;
  while ((found = nodes.exec(text)) !== null) {
    const attrs = found[1] ?? '';
    const inner = (found[2] ?? '').trim();
    if (inner === '') continue;
    const xMatch = /\bx\s*=\s*"([^"]*)"/i.exec(attrs);
    const yMatch = /\by\s*=\s*"([^"]*)"/i.exec(attrs);
    const x = firstNumber(xMatch?.[1] ?? null) ?? 0;
    const y = firstNumber(yMatch?.[1] ?? null) ?? 0;
    if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
      out.push(inner);
    }
  }
  return out;
}

export type ImageExt = 'svg' | 'png' | 'jpg' | 'bin';

export function detectImageExt(data: Buffer, mime: string, filename: string): ImageExt {
  const hint = `${mime} ${filename}`.toLowerCase();
  if (hint.includes('svg') || SVG_OPEN.test(data.subarray(0, 512).toString('utf8'))) return 'svg';
  const isPngMagic = data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  if (hint.includes('png') || isPngMagic) return 'png';
  const isJpegMagic = data.length >= 2 && data[0] === 0xff && data[1] === 0xd8;
  if (hint.includes('jpeg') || hint.includes('jpg') || isJpegMagic) return 'jpg';
  return 'bin';
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Annotated artifact: SVG gets real <rect> overlays injected before </svg>;
// raster bytes are copied untouched with a .boxes.json sidecar, because
// drawing pixels without a codec would be theater.
export function annotateImage(
  data: Buffer,
  ext: ImageExt,
  regions: Array<{ phrase: string; box: AnchorBox }>,
  outPath: string
): string {
  if (ext === 'svg') {
    const text = data.toString('utf8');
    const rects = regions
      .map(
        (region) =>
          `<rect x="${region.box.x}" y="${region.box.y}" width="${region.box.width}" height="${region.box.height}" ` +
          `fill="none" stroke="#ff3b30" stroke-width="3"><title>${escapeXml(region.phrase)}</title></rect>`
      )
      .join('');
    const close = text.lastIndexOf('</svg>');
    const annotated = close === -1 ? text + rects : text.slice(0, close) + rects + text.slice(close);
    fs.writeFileSync(outPath, annotated, 'utf8');
    return outPath;
  }
  fs.writeFileSync(outPath, data);
  fs.writeFileSync(
    `${outPath}.boxes.json`,
    JSON.stringify({ regions: regions.map((region) => ({ phrase: region.phrase, box: region.box })) }),
    'utf8'
  );
  return outPath;
}

export function submitLinkSubmission(
  pipeline: Pipeline,
  value: string,
  surface: ObservationSurface
): Promise<SubmissionResult> {
  return pipeline.submitLink(value, surface);
}

export interface CreativeFile {
  data: Buffer;
  filename: string;
  mime: string;
}

export interface CreativeRegion {
  phrase: string;
  box: AnchorBox;
  extractedText: string;
}

export interface CreativeResult {
  card: Card | null;
  declineReason: string | null;
  observationId: string | null;
  regions: CreativeRegion[];
  annotatedImageRef: string;
}

export interface CreativeOptions {
  fetchImpl?: typeof fetch;
}

export async function submitCreativeSubmission(
  pipeline: Pipeline,
  file: CreativeFile,
  surface: ObservationSurface,
  opts: CreativeOptions = {}
): Promise<CreativeResult> {
  const runDir = pipeline.getRunDir();
  const creatives = path.join(runDir, 'creatives');
  fs.mkdirSync(creatives, { recursive: true });
  const hash = sha256Hex(file.data);
  const ext = detectImageExt(file.data, file.mime, file.filename);
  const original = path.join(creatives, `${hash}.${ext}`);
  if (!fs.existsSync(original)) fs.writeFileSync(original, file.data);
  const located = await locateAnchors(file.data, { runDir, fetchImpl: opts.fetchImpl });
  const found = located.ok ? located.regions : [];
  const indicators: Indicator[] = [{ kind: 'file_hash', value: hash }];
  const extractedTexts: string[] = [];
  for (const region of found) {
    const texts = extractSvgText(file.data, region.box);
    extractedTexts.push(texts.join(' '));
    for (const text of texts) {
      indicators.push({ kind: classifySubmissionValue(text), value: text });
    }
  }
  const annotatedImageRef = annotateImage(
    file.data,
    ext,
    found,
    path.join(creatives, `${hash}-annotated.${ext}`)
  );
  const sub = await pipeline.submitCreative(indicators, surface);
  // The observation is recorded either way (§8.4: both paths produce it);
  // only the reason differs, and a dead localizer should say so rather than
  // hide behind the ineligible-cluster fallback the file-hash-only evidence
  // would otherwise produce.
  const declineReason = sub.card === null && !located.ok ? `localization_failed:${located.code}` : sub.declineReason;
  return {
    card: sub.card,
    declineReason,
    observationId: sub.observationId,
    regions: found.map((region, index) => ({
      phrase: region.phrase,
      box: region.box,
      extractedText: extractedTexts[index] ?? ''
    })),
    annotatedImageRef
  };
}
