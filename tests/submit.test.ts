import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pipeline } from '../src/pipeline.js';
import type { Card, ProposeFn } from '../src/cards.js';
import { createApp } from '../src/server.js';
import { renderAgo } from '../src/validate.js';
import { startFeed } from '../src/connectors/public.js';
import { classifySubmissionValue, extractSvgText } from '../src/connectors/submit.js';
import { sha256Hex } from '../src/models/sam.js';

// P9: submission paths end to end over HTTP. Loopback traffic passes through
// to the real server; every other outbound request is stubbed and asserted,
// so a test that phones anywhere unexpected fails loudly.

const NOW_MS = Date.parse('2026-06-10T12:00:00.000Z');
const FEED_PUBLISHED_AT = '2026-06-05T12:00:00.000Z';
const FEED_URL = 'https://feeds.example/scam-urls.txt';
const FEED_NAME = 'example-feed';
const SAM_BASE = 'https://sam.example';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const realFetch = globalThis.fetch.bind(globalThis);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

interface Outbound {
  samCalls: string[];
  feedCalls: number;
  other: string[];
}

function stubOutbound(opts: {
  feedBody?: string;
  localize?: (body: string) => { status: number; json: unknown };
} = {}): Outbound {
  const state: Outbound = { samCalls: [], feedCalls: 0, other: [] };
  const handler = opts.localize ?? (() => ({ status: 200, json: responsesEnvelope(['']) }));
  vi.stubGlobal('fetch', async (url: unknown, init?: unknown) => {
    const href = String(url);
    if (href.startsWith('http://127.0.0.1')) return realFetch(href, init as RequestInit);
    if (href === FEED_URL) {
      state.feedCalls += 1;
      return new Response(opts.feedBody ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    if (href === `${SAM_BASE}/responses`) {
      const body = String((init as { body?: unknown } | undefined)?.body ?? '');
      state.samCalls.push(body);
      const canned = handler(body);
      return new Response(JSON.stringify(canned.json), {
        status: canned.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    state.other.push(href);
    throw new Error(`unexpected outbound ${href}`);
  });
  return state;
}

function setup(propose?: ProposeFn): { root: string; runDir: string; pipeline: Pipeline; app: Express } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metshield-p9-'));
  const runId = 'run-p9';
  const pipeline = new Pipeline({ root, runId, now: () => NOW_MS, ...(propose === undefined ? {} : { propose }) });
  return { root, runDir: path.join(root, runId), pipeline, app: createApp(pipeline) };
}

async function serve(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  return { url, close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))) };
}

const proposeThrow: ProposeFn = () => {
  throw new Error('model must not be called');
};

function proposeF(feedName: string): ProposeFn {
  return async (_cluster, indicators) => {
    const domain = indicators.find((stored) => stored.indicator.family === 'domain');
    if (domain === undefined) throw new Error('no domain to cite');
    return {
      ok: true,
      data: {
        decision: 'emit',
        tier: 'confirmed',
        headline: 'This link is on a public blocklist.',
        body:
          `This domain is listed in ${feedName}'s reported-scam feed, published ${renderAgo(NOW_MS, FEED_PUBLISHED_AT)}. ` +
          'That listing is the whole of our evidence — we have not seen it in a conversation or in an ad, ' +
          'and a listing is a claim about the domain, not proof about every use of it.',
        safeAction: 'leave_and_report',
        citations: [domain.id, domain.id],
        declineReason: null,
        confidence: 0.9
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      ms: 0
    };
  };
}

function svgDoc(inner: string): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
      '<rect x="0" y="0" width="512" height="512" fill="#111827"/>' +
      inner +
      '</svg>',
    'utf8'
  );
}

function multipart(
  file: { data: Buffer; filename: string; mime: string } | null,
  fields: Record<string, string> = {}
): { body: Buffer; contentType: string } {
  const boundary = '----p9boundary';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  }
  if (file !== null) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.mime}\r\n\r\n`,
        'utf8'
      )
    );
    parts.push(file.data);
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

interface CreativePayload {
  card: Card | null;
  declineReason: string | null;
  observationId: string | null;
  regions: Array<{ phrase: string; extractedText: string }>;
  annotatedImageRef: string;
}

interface LinkPayload {
  card: Card | null;
  declineReason: string | null;
  observationId: string | null;
}

// The privacy invariant is that no projected file *identifies* an actor, so
// compare whole string values rather than substrings: a feed observation id is
// `feed:<name>:<domain>`, which contains the feed's actorRef by construction
// while carrying no identity of its own.
function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) stringLeaves(v, out);
  }
  return out;
}

function parseRecords(text: string): unknown[] {
  try {
    return [JSON.parse(text) as unknown];
  } catch {
    return text
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as unknown);
  }
}

// DOM fetch types demand a view over a real ArrayBuffer; Node Buffers ride
// on ArrayBufferLike, so copy once at the boundary.
function asBody(body: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(body.length);
  copy.set(body);
  return copy;
}

async function postCreative(
  url: string,
  file: { data: Buffer; filename: string; mime: string },
  fields: Record<string, string> = {}
): Promise<{ status: number; payload: CreativePayload }> {
  const { body, contentType } = multipart(file, fields);
  const res = await realFetch(`${url}/v1/submissions/creative`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: asBody(body)
  });
  return { status: res.status, payload: (await res.json()) as CreativePayload };
}

async function postLink(
  url: string,
  value: string,
  surface: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; payload: LinkPayload }> {
  const res = await realFetch(`${url}/v1/submissions/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ value, surface })
  });
  return { status: res.status, payload: (await res.json()) as LinkPayload };
}

function responsesEnvelope(texts: string[]): unknown {
  return {
    output: [{ type: 'message', content: texts.map((text) => ({ type: 'output_text', text })) }]
  };
}

function samLine(box: [number, number, number, number]): string {
  const [x, y, width, height] = box;
  return (
    `<0f>0<|box;x1=${x};y1=${y};x2=${x + width - 1};y2=${y + height - 1};w=512;h=512;c=0.97|>` +
    '<|mask;x=0;y=0;data=2,2,!!!!!|>'
  );
}

// One phrase per request: the stub answers only the expected noun phrase and
// returns an empty lane for the other four, mirroring a real localizer.
function phraseAware(
  phrase: string,
  box: [number, number, number, number]
): (body: string) => { status: number; json: unknown } {
  return (body: string) => {
    let asked = '';
    try {
      const parsed = JSON.parse(body) as { input?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
      const content = parsed.input?.[0]?.content ?? [];
      asked = content.find((part) => part.type === 'input_text')?.text ?? '';
    } catch {
      asked = '';
    }
    return { status: 200, json: responsesEnvelope([asked === phrase ? samLine(box) : '']) };
  };
}

describe('submission', () => {
  it('extracts a handle from a fixture creative into a payment_handle indicator', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', SAM_BASE);
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
    const outbound = stubOutbound({ localize: phraseAware('payment handle', [40, 370, 200, 40]) });
    const { pipeline, app } = setup(proposeThrow);
    const { url, close } = await serve(app);
    try {
      const file = svgDoc('<text x="60" y="400" font-size="28" fill="#f9fafb">@pay.desk</text>');
      const { status, payload } = await postCreative(
        url,
        { data: file, filename: 'offer.svg', mime: 'image/svg+xml' },
        { surface: 'messenger' }
      );
      expect(status).toBe(200);
      expect(payload.card).toBeNull();
      expect(payload.declineReason).toBe('ineligible_cluster');
      expect(payload.regions).toHaveLength(1);
      expect(payload.regions[0]?.phrase).toBe('payment handle');
      expect(payload.regions[0]?.extractedText).toContain('@pay.desk');
      expect(typeof payload.observationId).toBe('string');
      const stored = pipeline.getObservation(payload.observationId as string);
      expect(stored?.observation.source).toBe('submission');
      expect(stored?.observation.surface).toBe('user_submission');
      expect(stored?.observation.eventKind).toBe('creative');
      expect(stored?.observation.consent).toBe('user_submitted');
      expect(stored?.observation.synthetic).toBe(false);
      expect(UUID_SHAPE.test(stored?.observation.actorRef ?? '')).toBe(true);
      const kinds = (stored?.observation.indicators ?? []).map((item) => `${item.kind}:${item.value}`);
      expect(kinds).toContain('payment_handle:@pay.desk');
      expect(kinds.some((entry) => entry.startsWith('file_hash:'))).toBe(true);
      expect(fs.existsSync(payload.annotatedImageRef)).toBe(true);
      expect(fs.readFileSync(payload.annotatedImageRef, 'utf8')).toContain('<rect');
      expect(outbound.samCalls).toHaveLength(5);
      expect(outbound.other).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('caches the localization on disk and skips the second call', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', SAM_BASE);
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
    const outbound = stubOutbound({ localize: phraseAware('payment handle', [40, 370, 200, 40]) });
    const { runDir, app } = setup(proposeThrow);
    const { url, close } = await serve(app);
    try {
      const file = svgDoc('<text x="60" y="400" font-size="28" fill="#f9fafb">@pay.desk</text>');
      const first = await postCreative(url, { data: file, filename: 'offer.svg', mime: 'image/svg+xml' });
      const second = await postCreative(url, { data: file, filename: 'offer.svg', mime: 'image/svg+xml' });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.payload.regions).toEqual(first.payload.regions);
      expect(outbound.samCalls).toHaveLength(5);
      expect(fs.existsSync(path.join(runDir, 'creatives', `${sha256Hex(file)}.json`))).toBe(true);
    } finally {
      await close();
    }
  });

  it('a blank image yields no content indicators and a decline, not an error', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', SAM_BASE);
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
    stubOutbound({ localize: () => ({ status: 200, json: responsesEnvelope(['']) }) });
    const { pipeline, app } = setup(proposeThrow);
    const { url, close } = await serve(app);
    try {
      const { status, payload } = await postCreative(url, { data: svgDoc(''), filename: 'blank.svg', mime: 'image/svg+xml' });
      expect(status).toBe(200);
      expect(payload.card).toBeNull();
      expect(payload.declineReason).toBe('ineligible_cluster');
      expect(payload.regions).toEqual([]);
      // The file hash is provenance, recorded always; "no indicators" means
      // no content evidence was manufactured from a blank image.
      const stored = pipeline.getObservation(payload.observationId as string);
      expect(stored?.observation.indicators.length).toBeGreaterThan(0);
      for (const item of stored?.observation.indicators ?? []) {
        expect(item.kind).toBe('file_hash');
      }
    } finally {
      await close();
    }
  });

  it('a creative extracting a listed domain yields the confirmed card', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', SAM_BASE);
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
    const outbound = stubOutbound({
      feedBody: 'https://evil.example/offer\nhttps://other.example/x\n',
      localize: phraseAware('contact button', [40, 415, 200, 40])
    });
    const { pipeline, app } = setup(proposeF(FEED_NAME));
    const reader = startFeed({
      name: FEED_NAME,
      url: FEED_URL,
      format: 'lines',
      pollMs: 60000,
      assertedClaim: 'listing',
      publishedAt: FEED_PUBLISHED_AT,
      onObservation: (obs, meta) => {
        pipeline.ingest(obs, meta);
      },
      now: () => NOW_MS
    });
    try {
      await reader.poll();
      const { url, close } = await serve(app);
      try {
        const file = svgDoc('<text x="60" y="440" font-size="20" fill="#f9fafb">evil.example</text>');
        const { status, payload } = await postCreative(
          url,
          { data: file, filename: 'ad.svg', mime: 'image/svg+xml' },
          { surface: 'messenger' }
        );
        expect(status).toBe(200);
        const card = payload.card;
        expect(card).not.toBeNull();
        if (card === null) throw new Error('expected a card');
        expect(card.tier).toBe('confirmed');
        expect(card.template).toBe('F');
        expect(card.provenance.sources).toEqual(['public_feed', 'submission']);
        expect(card.provenance.synthetic).toBe(false);
        expect(card.provenance.evidenceBasis).toBe('source_reported');
        expect(card.provenance.attribution?.feedName).toBe(FEED_NAME);
        expect(card.provenance.attribution?.publishedAt).toBe(FEED_PUBLISHED_AT);
        expect(card.provenance.attribution?.assertedClaim).toBe('listing');
        expect(card.citations).toHaveLength(2);
        const surfaces = card.citations.map((citation) => citation.surface).sort();
        expect(surfaces).toEqual(['public_feed', 'user_submission']);
        const obsIds = card.citations.map((citation) => citation.observationId);
        expect(new Set(obsIds).size).toBe(2);
        for (const obsId of obsIds) {
          expect(pipeline.getObservation(obsId)).toBeDefined();
        }
        const joined = pipeline.getIndicatorById(card.citations[0]?.indicatorId as string);
        expect(joined?.indicator.family).toBe('domain');
        expect(joined?.indicator.canonical).toBe('evil.example');
        expect(card.body).toContain('we have not seen it in a conversation or in an ad');
        // Asserted by id on the returned card, never on an aggregate counter.
        expect(pipeline.getCards().map((entry) => entry.id)).toEqual([card.id]);
        expect(outbound.other).toHaveLength(0);
        console.log(`P9-CREATIVE ${JSON.stringify({ response: payload, annotatedImageRef: payload.annotatedImageRef })}`);
      } finally {
        await close();
      }
    } finally {
      reader.stop();
    }
  });

  it('link submissions mint opaque actorRefs, never merged by actor', async () => {
    stubOutbound();
    const { pipeline, app } = setup(proposeThrow);
    const { url, close } = await serve(app);
    try {
      const headers = { 'x-test-caller': 'caller-marker-9f3a' };
      const first = await postLink(url, '@desk.clerk', 'messenger', headers);
      const second = await postLink(url, '@desk.clerk', 'messenger', headers);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const obsA = pipeline.getObservation(first.payload.observationId as string)?.observation;
      const obsB = pipeline.getObservation(second.payload.observationId as string)?.observation;
      expect(obsA?.actorRef).toMatch(UUID_SHAPE);
      expect(obsB?.actorRef).toMatch(UUID_SHAPE);
      expect(obsA?.actorRef).not.toBe(obsB?.actorRef);
      expect(obsA?.actorRef).not.toContain('caller-marker-9f3a');
      expect(obsB?.actorRef).not.toContain('caller-marker-9f3a');
      expect(obsA?.synthetic).toBe(false);
      expect(obsA?.consent).toBe('user_submitted');
      // One cluster: merged by the shared handle indicator, not by actor.
      expect(pipeline.getMetrics().clusters).toBe(1);
    } finally {
      await close();
    }
  });

  it('records actorRefs only in observations.jsonl', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', SAM_BASE);
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
    stubOutbound({
      feedBody: 'https://evil.example/offer\nhttps://other.example/x\n',
      localize: phraseAware('payment handle', [40, 370, 200, 40])
    });
    const { runDir, pipeline, app } = setup(proposeF(FEED_NAME));
    const reader = startFeed({
      name: FEED_NAME,
      url: FEED_URL,
      format: 'lines',
      pollMs: 60000,
      assertedClaim: 'listing',
      publishedAt: FEED_PUBLISHED_AT,
      onObservation: (obs, meta) => {
        pipeline.ingest(obs, meta);
      },
      now: () => NOW_MS
    });
    try {
      await reader.poll();
      const { url, close } = await serve(app);
      try {
        const link = await postLink(url, 'evil.example', 'messenger');
        expect(link.payload.card?.tier).toBe('confirmed');
        const file = svgDoc('<text x="60" y="400" font-size="28" fill="#f9fafb">@pay.desk</text>');
        const creative = await postCreative(url, { data: file, filename: 'offer.svg', mime: 'image/svg+xml' });
        expect(creative.status).toBe(200);
        const refs: string[] = [];
        for (const line of fs.readFileSync(path.join(runDir, 'observations.jsonl'), 'utf8').split('\n')) {
          if (line.length === 0) continue;
          const record = JSON.parse(line) as { observation?: { actorRef?: unknown } };
          if (typeof record.observation?.actorRef === 'string') refs.push(record.observation.actorRef);
        }
        expect(refs.length).toBeGreaterThanOrEqual(4);
        for (const name of ['indicators.jsonl', 'cards.jsonl', 'clusters.json', 'actions.jsonl']) {
          // clusters.json and actions.jsonl have no writer yet (P10/P12); the
          // scan covers every file that exists rather than asserting absence.
          const filePath = path.join(runDir, name);
          if (!fs.existsSync(filePath)) continue;
          const text = fs.readFileSync(filePath, 'utf8');
          const leaves = parseRecords(text).flatMap((record) => stringLeaves(record));
          for (const ref of refs) {
            expect(leaves).not.toContain(ref);
          }
        }
        expect(fs.existsSync(path.join(runDir, 'cards.jsonl'))).toBe(true);
      } finally {
        await close();
      }
    } finally {
      reader.stop();
    }
  });

  it('rejects malformed creative uploads with coded errors', async () => {
    stubOutbound({ localize: () => ({ status: 200, json: responsesEnvelope(['']) }) });
    const { app } = setup(proposeThrow);
    const { url, close } = await serve(app);
    try {
      const plain = await realFetch(`${url}/v1/submissions/creative`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not multipart'
      });
      expect(plain.status).toBe(400);
      expect(((await plain.json()) as { error: string }).error).toBe('content_type_invalid');

      const noFile = multipart(null, { surface: 'messenger' });
      const missing = await realFetch(`${url}/v1/submissions/creative`, {
        method: 'POST',
        headers: { 'Content-Type': noFile.contentType },
        body: asBody(noFile.body)
      });
      expect(missing.status).toBe(400);
      expect(((await missing.json()) as { error: string }).error).toBe('file_missing');

      const huge = multipart({ data: Buffer.alloc(5 * 1024 * 1024 + 1, 0x41), filename: 'big.bin', mime: 'image/png' });
      const tooLarge = await realFetch(`${url}/v1/submissions/creative`, {
        method: 'POST',
        headers: { 'Content-Type': huge.contentType },
        body: asBody(huge.body)
      });
      expect(tooLarge.status).toBe(413);
      expect(((await tooLarge.json()) as { error: string }).error).toBe('file_too_large');

      const empty = multipart({ data: Buffer.alloc(0), filename: 'empty.svg', mime: 'image/svg+xml' });
      const emptyRes = await realFetch(`${url}/v1/submissions/creative`, {
        method: 'POST',
        headers: { 'Content-Type': empty.contentType },
        body: asBody(empty.body)
      });
      expect(emptyRes.status).toBe(400);
      expect(((await emptyRes.json()) as { error: string }).error).toBe('image_empty');

      const badSurface = await postCreative(
        url,
        { data: svgDoc(''), filename: 'blank.svg', mime: 'image/svg+xml' },
        { surface: 'public_feed' }
      );
      expect(badSurface.status).toBe(400);

      // Missing surface defaults to facebook and still declines on evidence.
      const defaulted = await postCreative(url, { data: svgDoc(''), filename: 'blank.svg', mime: 'image/svg+xml' });
      expect(defaulted.status).toBe(200);
      expect(defaulted.payload.card).toBeNull();
      expect(typeof defaulted.payload.observationId).toBe('string');
    } finally {
      await close();
    }
  });

  it('an unconfigured localizer declines but still records the observation', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', '');
    vi.stubEnv('METASHIELD_API_KEY', '');
    const outbound = stubOutbound({ localize: phraseAware('payment handle', [40, 370, 200, 40]) });
    const { pipeline, app } = setup(proposeThrow);
    const { url, close } = await serve(app);
    try {
      const file = svgDoc('<text x="60" y="400" font-size="28" fill="#f9fafb">@pay.desk</text>');
      const { status, payload } = await postCreative(url, { data: file, filename: 'offer.svg', mime: 'image/svg+xml' });
      expect(status).toBe(200);
      expect(payload.card).toBeNull();
      expect(payload.declineReason).toBe('localization_failed:sam_unconfigured');
      expect(payload.regions).toEqual([]);
      expect(outbound.samCalls).toHaveLength(0);
      const stored = pipeline.getObservation(payload.observationId as string);
      expect(stored?.observation.eventKind).toBe('creative');
      for (const item of stored?.observation.indicators ?? []) {
        expect(item.kind).toBe('file_hash');
      }
    } finally {
      await close();
    }
  });

  it('a failing localizer retries once, then declines with the observation stored', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', SAM_BASE);
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
    const outbound = stubOutbound({ localize: () => ({ status: 500, json: {} }) });
    const { pipeline, app } = setup(proposeThrow);
    const { url, close } = await serve(app);
    try {
      const file = svgDoc('<text x="60" y="400" font-size="28" fill="#f9fafb">@pay.desk</text>');
      const { status, payload } = await postCreative(url, { data: file, filename: 'offer.svg', mime: 'image/svg+xml' });
      expect(status).toBe(200);
      expect(payload.card).toBeNull();
      expect(payload.declineReason).toBe('localization_failed:http_5xx');
      expect(outbound.samCalls).toHaveLength(2);
      expect(pipeline.getObservation(payload.observationId as string)).toBeDefined();
    } finally {
      await close();
    }
  });

  it.each([
    ['https://evil.example/x', 'offplatform_link'],
    ['www.evil.example', 'offplatform_link'],
    ['evil.example', 'offplatform_link'],
    ['@pay.desk', 'payment_handle'],
    ['pay desk', 'payment_handle'],
    ['+15551234567', 'offplatform_link'],
    ['refunddesk', 'payment_handle']
  ])('classifies %s as %s', (value, expected) => {
    expect(classifySubmissionValue(value)).toBe(expected);
  });

  it('extractSvgText reads only in-box text from SVG', () => {
    const file = svgDoc('<text x="60" y="400" font-size="28" fill="#f9fafb">@pay.desk</text>');
    expect(extractSvgText(file, { x: 40, y: 370, width: 200, height: 40 })).toEqual(['@pay.desk']);
    expect(extractSvgText(file, { x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
    expect(extractSvgText(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { x: 0, y: 0, width: 512, height: 512 })).toEqual([]);
  });
});
