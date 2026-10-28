// Thin client for the world API. Carries the fixture operator key (see
// server operatorAuth) on every call: this page is the operator console.
const OPERATOR_HEADERS: Record<string, string> = { 'x-operator-key': 'metshield-local-operator' };

export type Surface = 'facebook' | 'messenger' | 'whatsapp';

export interface SurfaceCounts {
  facebook: number;
  whatsapp: number;
  messenger: number;
}

export interface WorldSummary {
  seed: number;
  tick: number;
  simulatedAt: string;
  scale: number;
  accounts: {
    total: number;
    perSurface: SurfaceCounts;
    operators: number;
    shells: number;
  };
}

export interface AccountSummary {
  id: string;
  handle: string;
  displayName: string;
  surface: Surface;
  archetype: string;
  role: string;
  personId: string;
  // Number of this person's accounts on other surfaces: 0 means the account
  // drawer will show no linked accounts.
  linkedAccountCount: number;
}

export interface PersonaDTO {
  archetype: string;
  actionsPerDay: number;
  sociability: number;
  vigilance: number;
  gullibility: number;
  interests: [string, string, string];
  city: { name: string; utcOffset: number };
  wakeHour: number;
}

export interface AccountDetail {
  id: string;
  personId: string;
  displayName: string;
  handle: string;
  avatarSeed: number;
  joinedMonthsAgo: number;
  bio: string;
  followerCount: number;
  followingCount: number;
  kind: string;
  verified: boolean;
  role: string;
  surface: Surface;
  persona: PersonaDTO;
}

export interface LinkedAccount {
  id: string;
  surface: Surface;
  handle: string;
  displayName: string;
}

export interface AccountDetailResponse {
  account: AccountDetail;
  linkedAccountIds: string[];
  linkedPersonIds: string[];
  linkedAccounts: LinkedAccount[];
  bridge: unknown;
}

export interface IndicatorDTO {
  kind: string;
  value: string;
}

export interface WorldEventDTO {
  id: string;
  simMinute: number;
  seq: number;
  type: string;
  surface: Surface;
  actorId: string;
  targetId?: string;
  groupId?: string;
  indicators: IndicatorDTO[];
  claimCodes: string[];
  surfaceText: string;
  payload?: { reason: string };
}

export interface TrailEntry {
  stage: string;
  surface: Surface;
  actorId: string;
  atMinute: number;
}

export interface CampaignDTO {
  id: string;
  templateKey: string;
  operationId: string;
  stage: string;
  path: Surface[];
  startedAt: number;
  targetPersonId: string;
  targetHandle: string | null;
  amount?: number;
  outcome?: string | null;
  trail: TrailEntry[];
}

export interface WorldTruth {
  seed: number;
  tick: number;
  campaigns: Array<{
    id: string;
    templateKey: string;
    operationId: string;
    outcome: string | null;
    verdict: string | null;
    targetPersonId: string;
  }>;
  scamEventIds: string[];
  compromisedAccountIds: string[];
  operatorAccountIds: string[];
  shellAccountIds: string[];
}

export interface IntegrityDTO {
  observationsSent: number;
  truthLabelsSentToDetector: number;
  rawTextInObservations: number;
  campaignMarkersInObservations: number;
  canaryLeaks: number;
}

export interface ControlResult {
  seed: number;
  tick: number;
  simulatedAt: string;
  events: number;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: OPERATOR_HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

export const api = {
  state: (seed: number): Promise<WorldSummary> => get<WorldSummary>(`/api/world/state?seed=${seed}`),
  accounts: (seed: number): Promise<AccountSummary[]> => get<AccountSummary[]>(`/api/world/accounts?seed=${seed}`),
  account: (seed: number, id: string): Promise<AccountDetailResponse> =>
    get<AccountDetailResponse>(`/api/world/accounts/${encodeURIComponent(id)}?seed=${seed}`),
  accountEvents: (seed: number, id: string, limit: number): Promise<WorldEventDTO[]> =>
    get<WorldEventDTO[]>(`/api/world/accounts/${encodeURIComponent(id)}/events?seed=${seed}&limit=${limit}`),
  events: (seed: number, limit: number): Promise<WorldEventDTO[]> =>
    get<WorldEventDTO[]>(`/api/world/events?seed=${seed}&limit=${limit}`),
  campaigns: (seed: number): Promise<CampaignDTO[]> => get<CampaignDTO[]>(`/api/world/campaigns?seed=${seed}`),
  truth: (seed: number): Promise<WorldTruth> => get<WorldTruth>(`/api/world/truth?seed=${seed}`),
  integrity: (seed: number): Promise<IntegrityDTO> => get<IntegrityDTO>(`/api/world/integrity?seed=${seed}`),
  advance: async (seed: number, minutes: number): Promise<ControlResult> => {
    const res = await fetch(`/api/world/control?seed=${seed}`, {
      method: 'POST',
      headers: { ...OPERATOR_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes })
    });
    if (!res.ok) throw new Error(`${res.status} control`);
    return (await res.json()) as ControlResult;
  }
};
