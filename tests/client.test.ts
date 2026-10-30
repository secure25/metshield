import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { completeJson } from '../src/models/client.js';

const SCHEMA = z.object({ a: z.number() });

interface WireBody {
  model: string;
  temperature: number;
  response_format: {
    type: string;
    json_schema: { name: string; schema: { properties?: Record<string, unknown> } };
  };
}

interface Call {
  url: unknown;
  init: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
  } as unknown as Response;
}

function envelope(content: unknown): unknown {
  return {
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 }
  };
}

function baseArgs() {
  return {
    model: 'test-model',
    messages: [{ role: 'user' as const, content: 'hi' }],
    schema: SCHEMA,
    schemaName: 'test_schema',
    temperature: 0.2,
    timeoutMs: 1000
  };
}

describe('client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubEnv(): void {
    vi.stubEnv('METASHIELD_BASE_URL', 'https://api.test/v1');
    vi.stubEnv('METASHIELD_API_KEY', 'test-key');
  }

  function stubFetch(handler: (url: unknown, init: unknown) => unknown): { calls: Call[] } {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', (url: unknown, init: unknown) => {
      calls.push({ url, init });
      return handler(url, init);
    });
    return { calls };
  }

  it('sends json_schema and returns parsed data with usage', async () => {
    stubEnv();
    const { calls } = stubFetch(() => Promise.resolve(jsonResponse(envelope({ a: 1 }))));
    const result = await completeJson(baseArgs());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toEqual({ a: 1 });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(typeof result.ms).toBe('number');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test/v1/chat/completions');
    const init = calls[0].init as { method?: unknown; headers?: unknown; body?: unknown };
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key', 'Content-Type': 'application/json' });
    const sent = JSON.parse(String(init.body)) as WireBody;
    expect(sent.model).toBe('test-model');
    expect(sent.temperature).toBe(0.2);
    expect(sent.response_format.type).toBe('json_schema');
    expect(sent.response_format.json_schema.name).toBe('test_schema');
    expect(sent.response_format.json_schema.schema.properties).toHaveProperty('a');
  });

  it('returns http_400 without retrying', async () => {
    stubEnv();
    const { calls } = stubFetch(() => Promise.resolve(jsonResponse({ error: 'bad' }, 400)));
    const result = await completeJson(baseArgs());
    expect(result).toEqual({ ok: false, code: 'http_400', detail: 'HTTP 400' });
    expect(calls).toHaveLength(1);
  });

  it('retries once on 5xx then reports http_5xx', async () => {
    stubEnv();
    const { calls } = stubFetch(() => Promise.resolve(jsonResponse({ error: 'down' }, 503)));
    const result = await completeJson(baseArgs());
    expect(result).toEqual({ ok: false, code: 'http_5xx', detail: 'HTTP 503' });
    expect(calls).toHaveLength(2);
  });

  it('recovers when the retry succeeds', async () => {
    stubEnv();
    let n = 0;
    const { calls } = stubFetch(() => {
      n += 1;
      if (n === 1) return Promise.resolve(jsonResponse({ error: 'down' }, 503));
      return Promise.resolve(jsonResponse(envelope({ a: 2 })));
    });
    const result = await completeJson(baseArgs());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toEqual({ a: 2 });
    expect(calls).toHaveLength(2);
  });

  it('reports bad_json when the body is not JSON', async () => {
    stubEnv();
    stubFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('not json{{{')
      } as unknown as Response)
    );
    const result = await completeJson(baseArgs());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('bad_json');
  });

  it('reports schema_mismatch when the content shape is wrong', async () => {
    stubEnv();
    stubFetch(() => Promise.resolve(jsonResponse(envelope({ a: 'not-a-number' }))));
    const result = await completeJson(baseArgs());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('schema_mismatch');
  });

  it('maps body stream errors to timeout', async () => {
    stubEnv();
    stubFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.reject(new Error('socket hung up'))
      } as unknown as Response)
    );
    const result = await completeJson(baseArgs());
    expect(result).toEqual({ ok: false, code: 'timeout', detail: 'body read failed: socket hung up' });
  });

  it('reports timeout when nothing resolves in time', async () => {
    stubEnv();
    stubFetch(() => new Promise<Response>(() => {}));
    const result = await completeJson({ ...baseArgs(), timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('timeout');
  });

  it('throws when the endpoint is not configured', async () => {
    vi.stubEnv('METASHIELD_BASE_URL', '');
    vi.stubEnv('METASHIELD_API_KEY', '');
    await expect(completeJson(baseArgs())).rejects.toThrow(/METASHIELD_BASE_URL/);
  });
});
