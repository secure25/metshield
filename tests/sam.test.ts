import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSamRequest,
  extractOutputTexts,
  locateAnchors,
  parseSamOutputText,
  sniffMime
} from '../src/models/sam.js';

// Post-probe: SAM speaks the Responses API with the SAM 3 text grammar in one
// output_text lane. All transport tests stub fetch; no billed calls here.

const SAM_BASE = 'https://sam.example';

function responsesEnvelope(texts: string[]): unknown {
  return {
    output: [
      {
        type: 'message',
        content: texts.map((text) => ({ type: 'output_text', text }))
      }
    ]
  };
}

function stubResponses(handler: (body: string) => { status: number; json: unknown }): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: unknown, init: unknown) => {
    const href = String(url);
    if (href !== `${SAM_BASE}/responses`) throw new Error(`unexpected outbound ${href}`);
    const body = String((init as { body?: unknown } | undefined)?.body ?? '');
    calls.push(body);
    const canned = handler(body);
    return Promise.resolve(new Response(JSON.stringify(canned.json), { status: canned.status }));
  });
  return { calls };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metshield-sam-'));
}

describe('sam grammar', () => {
  it('parses the spec example into a half-open box with its payload', () => {
    const records = parseSamOutputText('<7f>0<|box;x1=10;y1=20;x2=14;y2=24;w=100;h=80|><|mask;x=0;y=0;data=5,5,!!!!!(QO(0lu8?|>');
    // Frame 7 is video: images keep frame 0 only.
    expect(records).toEqual([]);
    const image = parseSamOutputText('<0f>0<|box;x1=10;y1=20;x2=14;y2=24;w=100;h=80|><|mask;x=0;y=0;data=5,5,!!!!!(QO(0lu8?|>');
    expect(image).toHaveLength(1);
    expect(image[0]?.objectId).toBe('0');
    expect(image[0]?.box).toEqual({ x: 10, y: 20, width: 5, height: 5 });
    expect(image[0]?.sourceDims).toEqual({ width: 100, height: 80 });
    expect(image[0]?.score).toBeNull();
    expect(image[0]?.maskPayload).toBe('5,5,!!!!!(QO(0lu8?');
  });

  it('reads confidence and tolerates an invalid one', () => {
    const records = parseSamOutputText(
      '<0f>0<|box;x1=0;y1=0;x2=9;y2=9;w=100;h=100;c=0.75|><|mask;x=0;y=0;c=0.5;data=1,1,!!|>,' +
        '1<|box;x1=0;y1=0;x2=4;y2=4;w=100;h=100;c=nonsense|><|mask;x=0;y=0;data=1,1,!!|>'
    );
    expect(records).toHaveLength(2);
    expect(records[0]?.score).toBe(0.75);
    expect(records[1]?.score).toBeNull();
    expect(records[1]?.objectId).toBe('1');
  });

  it('skips malformed records and keeps the rest of the lane', () => {
    const records = parseSamOutputText(
      [
        '<0f>',
        '<0f>0<|box;x1=0;y1=0;x2=4;y2=4;w=100;h=100|><|mask;x=0;y=0;data=1,1,!!|>',
        '<0f>2<|box;x1=90;y1=90;x2=200;y2=200;w=100;h=100|><|mask;x=0;y=0;data=1,1,!!|>',
        '<0f>3<|box;x1=0;y1=0;x2=4;y2=4;w=100;h=100|>',
        'not a record at all'
      ].join('\n')
    );
    // Bare header, out-of-bounds box, missing mask, and prose all drop; the
    // one well-formed record survives.
    expect(records.map((record) => record.objectId)).toEqual(['0']);
  });

  it('extracts output_text from a unary envelope and rejects other shapes', () => {
    expect(extractOutputTexts(responsesEnvelope(['<0f>']))).toEqual(['<0f>']);
    expect(extractOutputTexts(responsesEnvelope([]))).toEqual([]);
    expect(extractOutputTexts({})).toBeNull();
    expect(extractOutputTexts({ output: [{ type: 'message' }] })).toEqual([]);
  });
});

describe('sam transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('posts one Responses request per phrase with the image as a data URL', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', SAM_BASE);
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
    const { calls } = stubResponses(() => ({ status: 200, json: responsesEnvelope(['']) }));
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const result = await locateAnchors(image, { runDir: tmpDir(), phrases: ['payment handle', 'QR code'] });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    for (const raw of calls) {
      const body = JSON.parse(raw) as ReturnType<typeof buildSamRequest>;
      expect(body.model).toBe('sam-3.1');
      expect(body.store).toBe(false);
      expect(body.metadata).toEqual({ include_confidence: 'true' });
      const content = body.input[0]?.content ?? [];
      expect(content[0]).toEqual({ type: 'input_text', text: expect.any(String) });
      const imagePart = content[1] as { type: string; image_url: string };
      expect(imagePart.type).toBe('input_image');
      expect(imagePart.image_url.startsWith('data:image/png;base64,')).toBe(true);
    }
    const phrases = calls.map((raw) => {
      const body = JSON.parse(raw) as ReturnType<typeof buildSamRequest>;
      return (body.input[0]?.content[0] as { text: string }).text;
    });
    expect(phrases).toEqual(['payment handle', 'QR code']);
  });

  it('attaches the requesting phrase to each parsed record', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', SAM_BASE);
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
    stubResponses(() => ({
      status: 200,
      json: responsesEnvelope(['<0f>0<|box;x1=40;y1=370;x2=239;y2=409;w=512;h=512;c=0.97|><|mask;x=0;y=0;data=2,2,!!!!!|>'])
    }));
    const result = await locateAnchors(Buffer.from('fake-png'), { runDir: tmpDir(), phrases: ['payment handle'] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.cached).toBe(false);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]?.phrase).toBe('payment handle');
    expect(result.regions[0]?.box).toEqual({ x: 40, y: 370, width: 200, height: 40 });
    expect(result.regions[0]?.score).toBe(0.97);
  });

  it('aborts on the first failing phrase after one 5xx retry', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', SAM_BASE);
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
    const { calls } = stubResponses(() => ({ status: 500, json: {} }));
    const result = await locateAnchors(Buffer.from('fake-png'), { runDir: tmpDir(), phrases: ['a', 'b'] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('http_5xx');
    // One retry on the first phrase, then abort: phrase b is never asked.
    expect(calls).toHaveLength(2);
  });

  it('treats a phrase-skewed cache entry as a miss', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', SAM_BASE);
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
    const { calls } = stubResponses(() => ({ status: 200, json: responsesEnvelope(['']) }));
    const runDir = tmpDir();
    const image = Buffer.from('same-bytes');
    await locateAnchors(image, { runDir, phrases: ['payment handle'] });
    await locateAnchors(image, { runDir, phrases: ['payment handle'] });
    expect(calls).toHaveLength(1);
    await locateAnchors(image, { runDir, phrases: ['QR code'] });
    expect(calls).toHaveLength(2);
  });

  it('sniffs image MIME types for the data URL', () => {
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('<svg xmlns="x"></svg>'))).toBe('image/svg+xml');
    expect(sniffMime(Buffer.from('???'))).toBe('application/octet-stream');
  });
});
