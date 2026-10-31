import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Observation } from '../src/contract.js';
import { sliceObservations } from '../src/world/observations.js';
import { startWorldReader } from '../src/connectors/world.js';

function obs(id: string): Observation {
  return {
    id,
    externalRef: id.replace('world:', ''),
    source: 'world',
    observedAt: '2026-01-01T00:01:00.000Z',
    surface: 'facebook',
    eventKind: 'message',
    actorRef: 'FB-1',
    subjectRef: null,
    threadRef: null,
    indicators: [],
    claimCodes: [],
    consent: 'none',
    synthetic: true
  };
}

function pageResponse(observations: unknown[], nextCursor: number): unknown {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ observations, nextCursor })
  };
}

describe('world reader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('advances the cursor and delivers each observation once', async () => {
    const received: string[] = [];
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        calls.push(String(url));
        const cursor = Number(new URL(String(url)).searchParams.get('cursor'));
        if (cursor === 0) return Promise.resolve(pageResponse([obs('world:EV-1'), obs('world:EV-2')], 2));
        if (cursor === 2) return Promise.resolve(pageResponse([obs('world:EV-3')], 3));
        return Promise.resolve(pageResponse([], 3));
      })
    );
    const reader = startWorldReader({
      baseUrl: 'http://127.0.0.1:5173',
      intervalMs: 60000,
      onObservation: (o) => {
        received.push(o.id);
      }
    });
    try {
      await reader.poll();
      expect(received).toEqual(['world:EV-1', 'world:EV-2']);
      expect(reader.getState()).toEqual({ cursor: 2, failures: 0, idle: false });
      await reader.poll();
      expect(received).toEqual(['world:EV-1', 'world:EV-2', 'world:EV-3']);
      expect(reader.getState().cursor).toBe(3);
      await reader.poll();
      expect(received).toHaveLength(3);
      expect(calls[0]).toContain('cursor=0');
      expect(calls[1]).toContain('cursor=2');
      expect(calls[2]).toContain('cursor=3');
    } finally {
      reader.stop();
    }
  });

  it('ignores a repeated delivery', async () => {
    const received: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        const cursor = Number(new URL(String(url)).searchParams.get('cursor'));
        if (cursor === 0) return Promise.resolve(pageResponse([obs('world:EV-1'), obs('world:EV-2')], 2));
        return Promise.resolve(pageResponse([obs('world:EV-2'), obs('world:EV-3')], 3));
      })
    );
    const reader = startWorldReader({
      baseUrl: 'http://127.0.0.1:5173',
      intervalMs: 60000,
      onObservation: (o) => {
        received.push(o.id);
      }
    });
    try {
      await reader.poll();
      await reader.poll();
      expect(received).toEqual(['world:EV-1', 'world:EV-2', 'world:EV-3']);
    } finally {
      reader.stop();
    }
  });

  it('goes idle silently on 404', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const reader = startWorldReader({
      baseUrl: 'http://127.0.0.1:5173',
      intervalMs: 60000,
      onObservation: () => {}
    });
    try {
      await reader.poll();
      expect(reader.getState().idle).toBe(true);
      expect(log).not.toHaveBeenCalled();
      await reader.poll();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      reader.stop();
    }
  });

  it('serves the contract Observation with no second shape', () => {
    const page = sliceObservations([], 0, 200);
    const observations: Observation[] = page.observations;
    expect(observations).toEqual([]);
    expect(page.nextCursor).toBe(0);
  });

  it('logs one world_unavailable line after N consecutive failures, then idles', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down')))
    );
    const reader = startWorldReader({
      baseUrl: 'http://127.0.0.1:5173',
      intervalMs: 60000,
      onObservation: () => {},
      maxFailures: 3
    });
    const unavailable = () => log.mock.calls.filter(([line]) => String(line).includes('world_unavailable'));
    try {
      await reader.poll();
      await reader.poll();
      expect(reader.getState()).toEqual({ cursor: 0, failures: 2, idle: false });
      expect(unavailable()).toHaveLength(0);
      await reader.poll();
      expect(reader.getState().idle).toBe(true);
      expect(unavailable()).toHaveLength(1);
      await reader.poll();
      expect(unavailable()).toHaveLength(1);
    } finally {
      reader.stop();
    }
  });

  it('resets the consecutive count on success', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls += 1;
      if (calls === 3) return Promise.resolve(pageResponse([], 0));
      return Promise.reject(new Error('down'));
    }));
    const reader = startWorldReader({
      baseUrl: 'http://127.0.0.1:5173',
      intervalMs: 60000,
      onObservation: () => {},
      maxFailures: 3
    });
    try {
      await reader.poll();
      await reader.poll();
      await reader.poll();
      expect(reader.getState()).toEqual({ cursor: 0, failures: 0, idle: false });
      await reader.poll();
      await reader.poll();
      expect(reader.getState()).toEqual({ cursor: 0, failures: 2, idle: false });
    } finally {
      reader.stop();
    }
  });

  it('survives pipeline errors without stalling the cursor', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(pageResponse([obs('world:EV-1')], 1))));
    const throwing = startWorldReader({
      baseUrl: 'http://127.0.0.1:5173',
      intervalMs: 60000,
      onObservation: () => {
        throw new Error('boom');
      }
    });
    try {
      await throwing.poll();
      expect(throwing.getState().cursor).toBe(1);
    } finally {
      throwing.stop();
    }
    const rejecting = startWorldReader({
      baseUrl: 'http://127.0.0.1:5173',
      intervalMs: 60000,
      onObservation: () => Promise.reject(new Error('async boom'))
    });
    try {
      await rejecting.poll();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejecting.getState().cursor).toBe(1);
    } finally {
      rejecting.stop();
    }
    expect(log.mock.calls.filter(([line]) => String(line).includes('world_pipeline_error'))).toHaveLength(2);
  });

  it(
    'polls repeatedly on its timer',
    async () => {
      const fetchMock = vi.fn(() => Promise.resolve(pageResponse([], 0)));
      vi.stubGlobal('fetch', fetchMock);
      const reader = startWorldReader({
        baseUrl: 'http://127.0.0.1:5173',
        intervalMs: 5,
        onObservation: () => {}
      });
      try {
        await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
      } finally {
        reader.stop();
      }
    },
    10000
  );
});
