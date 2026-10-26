import type { Surface } from '../contract.js';

export type AccountKind = 'person' | 'business';
export type AccountRole = 'legit' | 'shell' | 'operator' | 'taken_over';
export type Archetype = 'social' | 'daily' | 'light' | 'lurker';

export interface City {
  name: string;
  utcOffset: number;
}

export interface Persona {
  archetype: Archetype;
  actionsPerDay: number;
  sociability: number;
  vigilance: number;
  gullibility: number;
  interests: [string, string, string];
  city: City;
  wakeHour: number;
}

export interface WorldAccount {
  id: string;
  personId: string;
  displayName: string;
  handle: string;
  avatarSeed: number;
  joinedMonthsAgo: number;
  bio: string;
  followerCount: number;
  followingCount: number;
  kind: AccountKind;
  verified: boolean;
  role: AccountRole;
  surface: Surface;
  persona: Persona;
}

export interface ContactEdge {
  a: string;
  b: string;
  surface: Surface;
  close: boolean;
}

export interface FollowEdge {
  pageId: string;
  followerId: string;
  surface: Surface;
}

export interface WorldGroup {
  id: string;
  surface: Surface;
  name: string;
  topic: string;
  memberIds: string[];
}

export interface BridgeTie {
  otherPersonId: string;
  surfaces: [Surface, Surface];
  myAccounts: [string, string];
  theirAccounts: [string, string];
}

export interface WorldGraph {
  contactEdges: ContactEdge[];
  followEdges: FollowEdge[];
  groups: WorldGroup[];
  bridges: Record<string, BridgeTie>;
}

export interface WorldState {
  seed: number;
  tick: number;
  simulatedAt: string;
  scale: number;
  accounts: WorldAccount[];
  graph: WorldGraph;
}

export interface WorldSummary {
  seed: number;
  tick: number;
  simulatedAt: string;
  scale: number;
  accounts: {
    total: number;
    perSurface: {
      facebook: number;
      whatsapp: number;
      messenger: number;
    };
    operators: number;
    shells: number;
  };
}
