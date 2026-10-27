import type { Observation, Surface, EventKind } from '../contract.js';
import { simulatedAtFor } from './clock.js';
import type { WorldEvent, EventType } from './types.js';

// Closed maps: every world value must land in the contract unions through
// these tables. The record types fail compilation if a case is unmapped,
// so new surfaces or event types cannot slip into the feed unmapped.
const SURFACE_MAP: Record<string, Surface> = {
  facebook: 'facebook',
  messenger: 'messenger',
  whatsapp: 'whatsapp'
};

const KIND_MAP: Record<EventType, EventKind> = {
  ad_published: 'ad',
  post_published: 'post',
  post_seen: 'post',
  reaction_added: 'post',
  comment_posted: 'post',
  message_sent: 'message',
  group_invite_sent: 'group_invite',
  group_joined: 'group_invite',
  link_shared: 'link',
  payment_request_shown: 'message',
  credential_request_shown: 'message',
  payment_attempted: 'message',
  account_taken_over: 'message',
  account_recovered: 'message',
  warning_shown: 'message'
};

// The projection reads only the listed fields. Rendered copy, payloads,
// and anything the contract does not name are left behind by construction:
// the Observation type has nowhere to put them.
export function projectEvent(event: WorldEvent): Observation {
  return {
    id: `world:${event.id}`,
    externalRef: event.id,
    source: 'world',
    observedAt: simulatedAtFor(event.simMinute),
    surface: SURFACE_MAP[event.surface],
    eventKind: KIND_MAP[event.type],
    actorRef: event.actorId,
    subjectRef: event.targetId ?? null,
    threadRef: event.groupId ?? null,
    indicators: event.indicators.map((i) => ({ ...i })),
    claimCodes: [...event.claimCodes],
    consent: 'none',
    synthetic: true
  };
}

export interface ObservationPage {
  observations: Observation[];
  nextCursor: number;
}

// Cursor paging over event seq. The cursor is the last consumed seq; a page
// holds events above it. Rebuilds are deterministic per seed, so a client
// holding a cursor gets exactly the unconsumed suffix after a restart.
export function sliceObservations(events: WorldEvent[], cursor: number, limit: number): ObservationPage {
  const safeCursor = Number.isFinite(cursor) && cursor > 0 ? Math.floor(cursor) : 0;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 1000) : 200;
  const observations: Observation[] = [];
  let nextCursor = safeCursor;
  for (const e of events) {
    if (e.seq <= safeCursor) continue;
    if (observations.length >= safeLimit) break;
    observations.push(projectEvent(e));
    nextCursor = e.seq;
  }
  return { observations, nextCursor };
}
