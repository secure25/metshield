import { performance } from 'node:perf_hooks';
import { z } from 'zod';

export type CompletionCode = 'timeout' | 'http_400' | 'http_5xx' | 'bad_json' | 'schema_mismatch';

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export type CompletionResult<T> =
  | { ok: true; data: T; usage: CompletionUsage; ms: number }
  | { ok: false; code: CompletionCode; detail: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteJsonArgs<T> {
  model: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  schemaName: string;
  temperature: number;
  timeoutMs: number;
}

type FetchOutcome = { kind: 'responded'; status: number; text: string } | { kind: 'failed'; detail: string };

async function postOnce(url: string, key: string, body: string, timeoutMs: number): Promise<FetchOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body,
        signal: controller.signal
      }).then(
        async (res): Promise<FetchOutcome> => {
          let text: string;
          try {
            text = await res.text();
          } catch (err) {
            return { kind: 'failed', detail: `body read failed: ${err instanceof Error ? err.message : String(err)}` };
          }
          return { kind: 'responded', status: res.status, text };
        },
        (err: unknown): FetchOutcome => ({
          kind: 'failed',
          detail: `fetch failed: ${err instanceof Error ? err.message : String(err)}`
        })
      ),
      new Promise<FetchOutcome>((resolve) => {
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

function envelopeContent(envelope: unknown): string | null {
  if (typeof envelope !== 'object' || envelope === null) return null;
  const choices: unknown = (envelope as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) return null;
  const message: unknown = (first as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return null;
  const content: unknown = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : null;
}

function envelopeUsage(envelope: unknown): CompletionUsage {
  if (typeof envelope !== 'object' || envelope === null) return { inputTokens: 0, outputTokens: 0 };
  const usage: unknown = (envelope as { usage?: unknown }).usage;
  if (typeof usage !== 'object' || usage === null) return { inputTokens: 0, outputTokens: 0 };
  const record = usage as Record<string, unknown>;
  return {
    inputTokens: typeof record.prompt_tokens === 'number' ? record.prompt_tokens : 0,
    outputTokens: typeof record.completion_tokens === 'number' ? record.completion_tokens : 0
  };
}

function logCall(model: string, ms: number, usage: CompletionUsage, ok: boolean): void {
  console.log(
    JSON.stringify({
      event: 'model_call',
      model,
      ms,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ok
    })
  );
}

async function attemptOnce<T>(
  baseUrl: string,
  apiKey: string,
  body: string,
  args: CompleteJsonArgs<T>
): Promise<CompletionResult<T>> {
  const started = performance.now();
  const outcome = await postOnce(`${baseUrl}/chat/completions`, apiKey, body, args.timeoutMs);
  const ms = Math.round(performance.now() - started);
  const zeroUsage = { inputTokens: 0, outputTokens: 0 };
  if (outcome.kind === 'failed') {
    logCall(args.model, ms, zeroUsage, false);
    return { ok: false, code: 'timeout', detail: outcome.detail };
  }
  if (outcome.status >= 500) {
    logCall(args.model, ms, zeroUsage, false);
    return { ok: false, code: 'http_5xx', detail: `HTTP ${outcome.status}` };
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    logCall(args.model, ms, zeroUsage, false);
    return { ok: false, code: 'http_400', detail: `HTTP ${outcome.status}` };
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(outcome.text) as unknown;
  } catch {
    logCall(args.model, ms, zeroUsage, false);
    return { ok: false, code: 'bad_json', detail: 'response body is not JSON' };
  }
  const usage = envelopeUsage(envelope);
  const content = envelopeContent(envelope);
  if (content === null) {
    logCall(args.model, ms, usage, false);
    return { ok: false, code: 'bad_json', detail: 'missing choices[0].message.content' };
  }
  let proposed: unknown;
  try {
    proposed = JSON.parse(content) as unknown;
  } catch {
    logCall(args.model, ms, usage, false);
    return { ok: false, code: 'bad_json', detail: 'content is not JSON' };
  }
  const parsed = args.schema.safeParse(proposed);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first === undefined ? 'schema mismatch' : `${first.path.join('.')}: ${first.message}`;
    logCall(args.model, ms, usage, false);
    return { ok: false, code: 'schema_mismatch', detail };
  }
  logCall(args.model, ms, usage, true);
  return { ok: true, data: parsed.data, usage, ms };
}

export async function completeJson<T>(args: CompleteJsonArgs<T>): Promise<CompletionResult<T>> {
  const baseUrl = process.env.METASHIELD_BASE_URL;
  const apiKey = process.env.METASHIELD_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('METASHIELD_BASE_URL and METASHIELD_API_KEY must be set');
  }
  const body = JSON.stringify({
    model: args.model,
    messages: args.messages,
    temperature: args.temperature,
    response_format: {
      type: 'json_schema',
      json_schema: { name: args.schemaName, schema: z.toJSONSchema(args.schema) }
    }
  });
  const first = await attemptOnce(baseUrl, apiKey, body, args);
  if (first.ok || first.code !== 'http_5xx') return first;
  return attemptOnce(baseUrl, apiKey, body, args);
}
