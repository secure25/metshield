import type { Surface, Indicator } from '../contract.js';

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

export type EventType =
  | 'ad_published'
  | 'post_published'
  | 'post_seen'
  | 'reaction_added'
  | 'comment_posted'
  | 'message_sent'
  | 'group_invite_sent'
  | 'group_joined'
  | 'link_shared'
  | 'payment_request_shown'
  | 'credential_request_shown'
  | 'payment_attempted'
  | 'account_taken_over'
  | 'account_recovered'
  | 'warning_shown';

export interface WorldEvent {
  id: string;
  simMinute: number;
  seq: number;
  type: EventType;
  surface: Surface;
  actorId: string;
  targetId?: string;
  groupId?: string;
  indicators: Indicator[];
  claimCodes: string[];
  surfaceText: string;
}

export interface PendingMessage {
  to: string;
  from: string;
  surface: Surface;
  since: number;
}

export interface WorldState {
  seed: number;
  tick: number;
  simulatedAt: string;
  scale: number;
  rateScale: Record<Surface, number>;
  accounts: WorldAccount[];
  graph: WorldGraph;
  events: WorldEvent[];
  seq: number;
  pending: PendingMessage[];
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
