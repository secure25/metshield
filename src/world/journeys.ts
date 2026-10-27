import { createRng, nextInt } from './rng.js';
import { hashSeedString } from './population.js';
import { contactsOf } from './graph.js';
import type { WorldAccount, WorldState, JourneyKind } from './types.js';
import type { StageEmit } from './campaigns.js';

const KINDS: JourneyKind[] = ['order', 'invite', 'friendpay', 'support'];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[nextInt(rng, 0, arr.length)];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slug(s: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return out.length > 0 ? out : 'shop';
}

export function journeyTick(seed: number, day: number, kind: JourneyKind): number {
  return nextInt(createRng(hashSeedString(`${seed}:journey:${day}:${kind}`)), 1, 1440);
}

function randomLegitEdge(rng: () => number, state: WorldState): [WorldAccount, WorldAccount] | null {
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const legit = state.graph.contactEdges.filter((e) => {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    return a?.role === 'legit' && b?.role === 'legit';
  });
  if (legit.length === 0) return null;
  const e = legit[nextInt(rng, 0, legit.length)];
  const a = byId.get(e.a);
  const b = byId.get(e.b);
  if (!a || !b) return null;
  return rng() < 0.5 ? [a, b] : [b, a];
}

function businessWithContact(rng: () => number, state: WorldState): [WorldAccount, WorldAccount] | null {
  const pages = state.accounts.filter((a) => a.kind === 'business' && a.role === 'legit');
  if (pages.length === 0) return null;
  for (let att = 0; att < 10; att++) {
    const page = pages[nextInt(rng, 0, pages.length)];
    const friends = contactsOf(state.graph, page.id);
    if (friends.length === 0) continue;
    const other = state.accounts.find((a) => a.id === friends[nextInt(rng, 0, friends.length)]);
    if (other && other.role === 'legit') return [page, other];
  }
  return null;
}

function runOrder(state: WorldState, tick: number, rng: () => number, emit: StageEmit): void {
  const pair = businessWithContact(rng, state);
  if (!pair) return;
  const [page, buyer] = pair;
  const interest = pick(rng, buyer.persona.interests);
  const url = `${slug(page.id)}.example/order/${nextInt(rng, 100, 999)}`;
  const price = nextInt(rng, 10, 120);
  emit('message_sent', page.surface, page.id, {
    targetId: buyer.id,
    surfaceText: `Your ${interest} order is ready — here is the pickup link.`
  });
  state.pending.push({ to: buyer.id, from: page.id, surface: page.surface, since: tick });
  emit('link_shared', page.surface, page.id, {
    targetId: buyer.id,
    indicators: [{ kind: 'offplatform_link', value: url }],
    claimCodes: ['delivery'],
    surfaceText: `Order link: ${url}`
  });
  emit('payment_request_shown', page.surface, buyer.id, {
    targetId: page.id,
    indicators: [{ kind: 'payment_handle', value: `${slug(page.id)}.pay.example` }],
    claimCodes: ['delivery'],
    surfaceText: `Payment request from ${page.displayName}: ${price} kivi.`
  });
  state.journeys.push({ id: `JRN-${Math.floor(tick / 1440)}-order`, kind: 'order', atMinute: tick, actorIds: [page.id, buyer.id] });
}

function runInvite(state: WorldState, tick: number, rng: () => number, emit: StageEmit): void {
  const pair = randomLegitEdge(rng, state);
  if (!pair) return;
  const [a, b] = pair;
  const mine = state.graph.groups.filter((g) => g.surface === a.surface && g.memberIds.includes(a.id));
  const pool = mine.length > 0 ? mine : state.graph.groups.filter((g) => g.surface === a.surface);
  if (pool.length === 0) return;
  const group = pool[nextInt(rng, 0, pool.length)];
  emit('group_invite_sent', a.surface, a.id, {
    targetId: b.id,
    groupId: group.id,
    surfaceText: `Join ${group.name}! Game night Friday.`
  });
  if (!group.memberIds.includes(b.id) && group.memberIds.length < 40) {
    group.memberIds.push(b.id);
    emit('group_joined', a.surface, b.id, { groupId: group.id, surfaceText: `Joined ${group.name}.` });
  }
  state.journeys.push({ id: `JRN-${Math.floor(tick / 1440)}-invite`, kind: 'invite', atMinute: tick, actorIds: [a.id, b.id] });
}

function runFriendPay(state: WorldState, tick: number, rng: () => number, emit: StageEmit): void {
  const pair = randomLegitEdge(rng, state);
  if (!pair) return;
  const [a, b] = pair;
  const price = nextInt(rng, 5, 60);
  emit('payment_request_shown', a.surface, b.id, {
    targetId: a.id,
    indicators: [{ kind: 'payment_handle', value: `${slug(a.id)}.pay.example` }],
    claimCodes: ['split-bill'],
    surfaceText: `Your share of dinner: ${price} kivi.`
  });
  emit('payment_attempted', a.surface, b.id, {
    targetId: a.id,
    indicators: [{ kind: 'payment_handle', value: `${slug(a.id)}.pay.example` }],
    claimCodes: ['split-bill'],
    surfaceText: `Paid ${price} kivi to ${a.displayName}.`
  });
  state.journeys.push({ id: `JRN-${Math.floor(tick / 1440)}-friendpay`, kind: 'friendpay', atMinute: tick, actorIds: [a.id, b.id] });
}

function runSupport(state: WorldState, tick: number, rng: () => number, emit: StageEmit): void {
  const pair = businessWithContact(rng, state);
  if (!pair) return;
  const [page, customer] = pair;
  const interest = pick(rng, customer.persona.interests);
  const s = page.surface;
  emit('message_sent', s, customer.id, {
    targetId: page.id,
    claimCodes: ['support'],
    surfaceText: `Hi! My ${interest} ${pick(rng, ['kit', 'order', 'bundle'])} arrived scuffed.`
  });
  state.pending.push({ to: page.id, from: customer.id, surface: s, since: tick });
  emit('message_sent', s, page.id, {
    targetId: customer.id,
    claimCodes: ['support'],
    surfaceText: `Sorry about that, ${capitalize(customer.displayName.split(' ')[0])} — a replacement goes out today.`
  });
  state.pending.push({ to: customer.id, from: page.id, surface: s, since: tick });
  emit('message_sent', s, customer.id, {
    targetId: page.id,
    claimCodes: ['support'],
    surfaceText: 'Thanks, appreciate it!'
  });
  state.pending.push({ to: page.id, from: customer.id, surface: s, since: tick });
  state.journeys.push({ id: `JRN-${Math.floor(tick / 1440)}-support`, kind: 'support', atMinute: tick, actorIds: [page.id, customer.id] });
}

export function runJourneys(state: WorldState, tick: number, rng: () => number, emit: StageEmit): void {
  const day = Math.floor(tick / 1440);
  const tod = tick % 1440;
  for (const kind of KINDS) {
    if (journeyTick(state.seed, day, kind) !== tod) continue;
    if (kind === 'order') runOrder(state, tick, rng, emit);
    else if (kind === 'invite') runInvite(state, tick, rng, emit);
    else if (kind === 'friendpay') runFriendPay(state, tick, rng, emit);
    else runSupport(state, tick, rng, emit);
  }
}
