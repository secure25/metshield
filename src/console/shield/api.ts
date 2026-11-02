import type { Card } from '../../cards.js';
import type { Proposal } from '../../models/muse.js';
import type { Cluster } from '../../correlate.js';
import type { PipelineMetrics } from '../../pipeline.js';

// Console API client (P11): typed fetch over the P10 routes. Every failure
// surfaces as an ApiError carrying the server's coded error, so the views
// render codes rather than empty panels.

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path);
  } catch (err: unknown) {
    throw new ApiError('network_error', 0, err instanceof Error ? err.message : 'fetch failed');
  }
  let body: unknown = null;
  try {
    body = (await res.json()) as unknown;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `http_${res.status}`;
    throw new ApiError(code, res.status);
  }
  return body as T;
}

export interface CardsPageResponse {
  cards: Card[];
  nextCursor: string | null;
}

export interface CardDetailResponse {
  card: Card;
  proposal: Proposal | null;
}

export function fetchClusters(): Promise<Cluster[]> {
  return getJson<{ clusters: Cluster[] }>('/v1/clusters').then((body) => body.clusters);
}

export function fetchCardsPage(limit = 50, cursor?: string): Promise<CardsPageResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor !== undefined) params.set('cursor', cursor);
  return getJson<CardsPageResponse>(`/v1/cards?${params.toString()}`);
}

export function fetchCardDetail(id: string): Promise<CardDetailResponse> {
  return getJson<CardDetailResponse>(`/v1/cards/${encodeURIComponent(id)}`);
}

export function fetchMetrics(): Promise<PipelineMetrics> {
  return getJson<PipelineMetrics>('/v1/metrics');
}

export interface HealthResponse {
  ok: boolean;
  version: string;
}

export function fetchHealth(): Promise<HealthResponse> {
  return getJson<HealthResponse>('/v1/health');
}

export type { Card, Proposal, Cluster, PipelineMetrics };
