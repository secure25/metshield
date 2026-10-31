import type { Observation } from '../contract.js';

// Living World connector: the one file on the product side that reads the
// world, over HTTP only. The route serves MetShield's own Observation shape
// ({ observations, nextCursor }, cursor = last consumed seq), so there is
// nothing to map and no second event shape. The world is read-only toward
// the product: nothing here ever posts back.
//
// poll() never throws: transport failures are counted toward maxFailures,
// pipeline errors are logged at the handoff, and malformed items are
// skipped. The store validates strictly on ingest; this module is transport.

export interface WorldReaderOptions {
  baseUrl: string;
  intervalMs: number;
  onObservation: (observation: Observation) => unknown;
  limit?: number;
  maxFailures?: number;
  seenCap?: number;
}

export interface WorldReaderState {
  cursor: number;
  failures: number;
  idle: boolean;
}

export interface WorldReader {
  /** Run one poll now. Exposed so tests can drive the reader deterministically. */
  poll: () => Promise<void>;
  stop: () => void;
  getState: () => WorldReaderState;
}

interface WorldPage {
  observations: Observation[];
  nextCursor: number;
}

function parsePage(data: unknown): WorldPage | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.observations) || typeof record.nextCursor !== 'number') return null;
  return { observations: record.observations as Observation[], nextCursor: record.nextCursor };
}

function handOff(observation: Observation, onObservation: (o: Observation) => unknown): void {
  // Fire and forget: model work inside the pipeline must never stall the
  // poll loop, but a rejection must not become an unhandled crash either.
  let result: unknown;
  try {
    result = onObservation(observation);
  } catch (err) {
    console.log(
      JSON.stringify({
        event: 'world_pipeline_error',
        observationId: observation.id,
        detail: err instanceof Error ? err.message : String(err)
      })
    );
    return;
  }
  const thenable = (result as PromiseLike<unknown> | null | undefined)?.then;
  if (typeof thenable === 'function') {
    (result as PromiseLike<unknown>).then(undefined, (err: unknown) => {
      console.log(
        JSON.stringify({
          event: 'world_pipeline_error',
          observationId: observation.id,
          detail: err instanceof Error ? err.message : String(err)
        })
      );
    });
  }
}

export function startWorldReader(options: WorldReaderOptions): WorldReader {
  const root = options.baseUrl.replace(/\/+$/, '');
  const limit = options.limit ?? 200;
  const maxFailures = options.maxFailures ?? 5;
  const seenCap = options.seenCap ?? 5000;
  const seen = new Set<string>();
  const state = { cursor: 0, failures: 0, idle: false, stopped: false };
  let timer: ReturnType<typeof setTimeout> | undefined;

  function goIdle(): void {
    state.idle = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function fail(detail: string): void {
    state.failures += 1;
    if (state.failures >= maxFailures) {
      console.log(JSON.stringify({ event: 'world_unavailable', baseUrl: root, failures: state.failures, detail }));
      goIdle();
    }
  }

  async function poll(): Promise<void> {
    if (state.stopped || state.idle) return;
    try {
      const res = await fetch(`${root}/api/world/observations?cursor=${state.cursor}&limit=${limit}`);
      // 404 is clean absence (no world behind this URL), not a failure:
      // go idle silently rather than burning through the failure budget.
      if (res.status === 404) {
        goIdle();
        return;
      }
      if (!res.ok) {
        fail(`HTTP ${res.status}`);
        return;
      }
      const page = parsePage((await res.json()) as unknown);
      if (page === null) {
        fail('malformed page');
        return;
      }
      for (const item of page.observations) {
        if (typeof item !== 'object' || item === null || typeof item.id !== 'string') continue;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        if (seen.size > seenCap) {
          const oldest = seen.keys().next();
          if (!oldest.done) seen.delete(oldest.value);
        }
        handOff(item, options.onObservation);
      }
      // The cursor is always the route's: never invented, never recomputed.
      state.cursor = page.nextCursor;
      state.failures = 0;
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      void poll().finally(() => {
        if (!state.stopped && !state.idle) schedule();
      });
    }, options.intervalMs);
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
  }

  // First poll fires after one interval, not at start, so manual drivers
  // (tests, tooling) never race an in-flight boot poll.
  schedule();

  return {
    poll,
    stop: () => {
      state.stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    getState: () => ({ cursor: state.cursor, failures: state.failures, idle: state.idle })
  };
}
