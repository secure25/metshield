import { createRng, nextInt } from './rng.js';
import { simulatedAtFor } from './clock.js';
import { hashSeedString } from './population.js';
import { runCampaigns } from './campaigns.js';
import { runJourneys } from './journeys.js';
import { contactsOf } from './graph.js';
import type { Surface, Indicator } from '../contract.js';
import type { WorldAccount, WorldEvent, WorldState, WorldGroup, EventType } from './types.js';

const SURFACES: Surface[] = ['facebook', 'whatsapp', 'messenger'];

export const BOOT_MINUTES = 180;

const POST_SUGGESTED = 36;
const STATUS_SUGGESTED = 46;
const AD_REACH = 64;
const AD_PAYSUB = 18;
const COMMENT_SEEN = 13;
const LINK_SEEN = 20;
const CHAT_LINK_SEEN = 4;
const GROUP_CAP = 40;
const REACT_P = 0.15;
const COMMENT_P = 0.04;
const REPLY_P = 0.8;
const JOIN_P = 0.5;
const PAY_BASE = 0.05;
const PENDING_TTL = 1440;

const MEAN_ACTIONS_PER_DAY = 0.08 * 11 + 0.32 * 5 + 0.36 * 2 + 0.24 * 0.5;

export function calibrationScale(accounts: WorldAccount[]): Record<Surface, number> {
  const totals: Record<Surface, number> = { facebook: 0, whatsapp: 0, messenger: 0 };
  const counts: Record<Surface, number> = { facebook: 0, whatsapp: 0, messenger: 0 };
  for (const a of accounts) {
    totals[a.surface] += a.persona.actionsPerDay;
    counts[a.surface] += 1;
  }
  const out = { ...totals };
  for (const s of SURFACES) {
    const target = counts[s] * MEAN_ACTIONS_PER_DAY;
    out[s] = totals[s] > 0 ? target / totals[s] : 1;
  }
  return out;
}

export const CLAIM_OFFER = 'offer';
export const CLAIM_URGENT = 'urgent';

function rawCurve(hoursSinceWake: number): number {
  if (hoursSinceWake < 2) return 0.5 + hoursSinceWake * 0.25;
  if (hoursSinceWake < 10) return 1.0;
  if (hoursSinceWake < 14) return 1.3;
  if (hoursSinceWake < 16) return 0.7;
  return 0.05;
}

const CURVE_MEAN: number = (() => {
  let s = 0;
  for (let h = 0; h < 48; h++) s += rawCurve(h / 2 + 0.25);
  return s / 48;
})();

export function activityCurve(tick: number, utcOffset: number, wakeHour: number): number {
  const localHour = (((tick / 60 + utcOffset) % 24) + 24) % 24;
  const sinceWake = (((localHour - wakeHour) % 24) + 24) % 24;
  return rawCurve(sinceWake) / CURVE_MEAN;
}

export interface OfferPage {
  id: string;
  surface: Surface;
  urgency: boolean;
}

export function offerPages(accounts: WorldAccount[]): OfferPage[] {
  const out: OfferPage[] = [];
  for (const s of SURFACES) {
    const biz = accounts
      .filter((a) => a.surface === s && a.kind === 'business')
      .map((a) => a.id)
      .sort();
    for (const id of biz.slice(0, 2)) out.push({ id, surface: s, urgency: false });
  }
  for (const i of [0, 3]) {
    if (out[i]) out[i].urgency = true;
  }
  return out;
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[nextInt(rng, 0, arr.length)];
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m: string, k: string) => vars[k] ?? `{${k}}`);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slug(s: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return out.length > 0 ? out : 'shop';
}

const POSTS = [
  '{Interest} morning, {city}!',
  'Anyone near {city} into {interest}?',
  'Three years of {interest} and still learning.',
  'Rainy day. Perfect for {interest}.',
  'Who is going to the {interest} meet this week?',
  'Just finished my {interest} project. Photos soon.',
  '{city} sunsets plus {interest}. Best combo.',
  'Hot take: {interest} is better with friends.',
  'Looking for {interest} tips. Beginners welcome?',
  'Sold my old {interest} kit. Time for an upgrade.',
  'Sunday plan: {interest}, snacks, repeat.',
  'The {topic} group convinced me to try {interest}.',
  'Day 30 of {interest}. Small wins.',
  '{Interest} people are the best people.'
];

const COMMENTS = [
  'So true.',
  'Love this!',
  'Which {interest} group?',
  'Haha exactly.',
  'Teach me your ways.',
  'Seen this in {city} too.',
  'Adding to my list.',
  'This made my day.',
  'Same here!',
  'Wait, how?'
];

const MESSAGES = [
  'hey, are you coming to {interest}?',
  'did you see the {topic} post?',
  'lunch in {city} tomorrow?',
  'sending the {interest} photos now',
  'are we still on for Saturday?',
  'you were right about {interest}',
  'call me when you can',
  'found it: {interest} supplies near {city}',
  'happy almost Friday',
  'what did the group decide?',
  'bring snacks',
  'running 10 min late'
];

const REPLIES = ['yes! see you there', 'haha exactly', 'on my way', 'sounds good', 'let me check', 'tomorrow works', 'oh nice', 'lol same'];

const LINKCAPS = ['thought of you', 'worth a read', 'this reminded me of {interest}', 'saving this here', 'from the {topic} thread', 'weekend plans?'];

const INVITES = ['Join {group}! We talk {topic}.', 'You would love {group}.', '{group} is looking for {interest} folks.', 'Come hang in {group}.'];

const OFFERS = ['{Product} — {price} kivi. Pay: {handle}', 'Fresh {product}: {price} kivi at {handle}', '{Product} for sale in {city}. {price} kivi to {handle}'];

const AD_GENERIC = ['{Interest} {suffix} in {city} — all welcome!', 'New to {interest}? Try our {suffix} nights.', '{city} {suffix}: {interest} every week.'];

const AD_SUFFIX = ['circle', 'meetup', 'workshop', 'nights'];

const REACTS = ['liked a post', 'loved a photo', 'laughed at a post', 'liked a comment'];

const PRODUCTS = ['kit', 'guide', 'workshop pass', 'bundle', 'circle seat'];

interface EvOpts {
  targetId?: string;
  groupId?: string;
  indicators?: Indicator[];
  claimCodes?: string[];
  surfaceText: string;
  payload?: { reason: string };
}

function sampleOthers(rng: () => number, ids: string[], exclude: Set<string>, n: number): string[] {
  const out: string[] = [];
  for (let att = 0; att < n * 10 + 20 && out.length < n; att++) {
    const id = ids[nextInt(rng, 0, ids.length)];
    if (!exclude.has(id)) {
      exclude.add(id);
      out.push(id);
    }
  }
  return out;
}

export function stepMinute(state: WorldState): void {
  state.tick += 1;
  state.simulatedAt = simulatedAtFor(state.tick);
  const tick = state.tick;
  const rng = createRng(hashSeedString(`${state.seed}:tick:${tick}`));
  if (state.pending.length > 0) {
    state.pending = state.pending.filter((p) => tick - p.since <= PENDING_TTL);
  }

  const offers = new Map(offerPages(state.accounts).map((o) => [o.id, o]));
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const graph = state.graph;
  const groupsBySurface: Record<Surface, WorldGroup[]> = { facebook: [], whatsapp: [], messenger: [] };
  for (const g of graph.groups) groupsBySurface[g.surface].push(g);
  const idsBySurface: Record<Surface, string[]> = { facebook: [], whatsapp: [], messenger: [] };
  for (const a of state.accounts) idsBySurface[a.surface].push(a.id);

  function ev(type: EventType, surface: Surface, actorId: string, opts: EvOpts): string {
    state.seq += 1;
    const e: WorldEvent = {
      id: `EV-${String(state.seq).padStart(6, '0')}`,
      simMinute: tick,
      seq: state.seq,
      type,
      surface,
      actorId,
      indicators: opts.indicators ?? [],
      claimCodes: opts.claimCodes ?? [],
      surfaceText: opts.surfaceText
    };
    if (opts.targetId !== undefined) e.targetId = opts.targetId;
    if (opts.groupId !== undefined) e.groupId = opts.groupId;
    if (opts.payload !== undefined) e.payload = { reason: opts.payload.reason };
    state.events.push(e);
    return e.id;
  }

  function varsFor(actor: WorldAccount): Record<string, string> {
    const interest = pick(rng, actor.persona.interests);
    const groups = groupsBySurface[actor.surface];
    const topic = groups.length > 0 ? pick(rng, groups).topic : interest;
    return {
      interest,
      Interest: capitalize(interest),
      city: actor.persona.city.name,
      topic
    };
  }

  function seenBy(viewerIds: string[], targetId: string, surface: Surface, text: string): void {
    for (const v of viewerIds) {
      ev('post_seen', surface, v, { targetId, surfaceText: text });
    }
  }

  function reactAndComment(viewerIds: string[], ownerId: string, surface: Surface): void {
    for (const v of viewerIds) {
      const viewer = byId.get(v);
      if (!viewer) continue;
      if (rng() < REACT_P) {
        ev('reaction_added', surface, v, { targetId: ownerId, surfaceText: pick(rng, REACTS) });
      }
      if (rng() < COMMENT_P) {
        ev('comment_posted', surface, v, { targetId: ownerId, surfaceText: fill(pick(rng, COMMENTS), varsFor(viewer)) });
        const watch = sampleOthers(rng, idsBySurface[surface], new Set([v, ownerId]), COMMENT_SEEN);
        seenBy(watch, ownerId, surface, 'Caught up on a thread.');
      }
    }
  }

  function doPost(actor: WorldAccount, status: boolean): void {
    const text = fill(pick(rng, POSTS), varsFor(actor));
    ev('post_published', actor.surface, actor.id, { surfaceText: text });
    const mine = new Set([actor.id, ...contactsOf(graph, actor.id)]);
    const viewers = [...contactsOf(graph, actor.id), ...sampleOthers(rng, idsBySurface[actor.surface], mine, status ? STATUS_SUGGESTED : POST_SUGGESTED)];
    seenBy(viewers, actor.id, actor.surface, 'Saw a post.');
    reactAndComment(viewers, actor.id, actor.surface);
  }

  function doReaction(actor: WorldAccount): void {
    const friends = contactsOf(graph, actor.id);
    if (friends.length === 0) return;
    ev('reaction_added', actor.surface, actor.id, { targetId: pick(rng, friends), surfaceText: pick(rng, REACTS) });
  }

  function doComment(actor: WorldAccount): void {
    const friends = contactsOf(graph, actor.id);
    if (friends.length === 0) return;
    const target = pick(rng, friends);
    ev('comment_posted', actor.surface, actor.id, { targetId: target, surfaceText: fill(pick(rng, COMMENTS), varsFor(actor)) });
    seenBy(sampleOthers(rng, idsBySurface[actor.surface], new Set([actor.id, target]), COMMENT_SEEN), target, actor.surface, 'Caught up on a thread.');
  }

  function doMessage(actor: WorldAccount): void {
    const friends = contactsOf(graph, actor.id);
    if (friends.length === 0) return;
    const target = pick(rng, friends);
    ev('message_sent', actor.surface, actor.id, { targetId: target, surfaceText: fill(pick(rng, MESSAGES), varsFor(actor)) });
    state.pending.push({ to: target, from: actor.id, surface: actor.surface, since: tick });
  }

  function doLink(actor: WorldAccount): void {
    const interest = pick(rng, actor.persona.interests);
    const url = `${slug(interest)}.example/${nextInt(rng, 100, 999)}`;
    const cap = fill(pick(rng, LINKCAPS), varsFor(actor));
    if (actor.surface === 'facebook') {
      ev('link_shared', actor.surface, actor.id, {
        indicators: [{ kind: 'offplatform_link', value: url }],
        surfaceText: `${cap}: ${url}`
      });
      seenBy(sampleOthers(rng, idsBySurface[actor.surface], new Set([actor.id]), LINK_SEEN), actor.id, actor.surface, 'Saw a post.');
    } else {
      const friends = contactsOf(graph, actor.id);
      if (friends.length === 0) return;
      const target = pick(rng, friends);
      ev('link_shared', actor.surface, actor.id, {
        targetId: target,
        indicators: [{ kind: 'offplatform_link', value: url }],
        surfaceText: `${cap}: ${url}`
      });
      const seen = [target, ...sampleOthers(rng, idsBySurface[actor.surface], new Set([actor.id, target]), CHAT_LINK_SEEN)];
      seenBy(seen, actor.id, actor.surface, 'Saw a post.');
    }
  }

  function doAd(actor: WorldAccount): void {
    const offer = offers.get(actor.id);
    if (offer) {
      const interest = pick(rng, actor.persona.interests);
      const product = `${capitalize(interest)} ${pick(rng, PRODUCTS)}`;
      const price = String(nextInt(rng, 5, 200));
      const handle = `${slug(actor.id)}.pay.example`;
      let text = fill(pick(rng, OFFERS), { ...varsFor(actor), Product: product, product: product.toLowerCase(), price, handle });
      const indicators: Indicator[] = [{ kind: 'payment_handle', value: handle }];
      const claimCodes = [CLAIM_OFFER];
      if (offer.urgency) {
        const urg = `Only ${nextInt(rng, 1, 4)} left — ends tonight!`;
        text = `${text} ${urg}`;
        indicators.push({ kind: 'urgency_phrase', value: urg });
        claimCodes.push(CLAIM_URGENT);
      }
      ev('ad_published', actor.surface, actor.id, { indicators, claimCodes, surfaceText: text });
      const viewers = sampleOthers(rng, idsBySurface[actor.surface], new Set([actor.id]), AD_REACH);
      seenBy(viewers, actor.id, actor.surface, 'Saw an ad.');
      const buyers = viewers.slice(0, Math.min(AD_PAYSUB, viewers.length));
      for (const b of buyers) {
        ev('payment_request_shown', actor.surface, b, {
          targetId: actor.id,
          indicators: [{ kind: 'payment_handle', value: handle }],
          claimCodes: [...claimCodes],
          surfaceText: `Payment request from ${actor.displayName}: ${price} kivi.`
        });
        const payer = byId.get(b);
        if (payer && rng() < payer.persona.gullibility * PAY_BASE) {
          ev('payment_attempted', actor.surface, b, {
            targetId: actor.id,
            indicators: [{ kind: 'payment_handle', value: handle }],
            claimCodes: [...claimCodes],
            surfaceText: `Paid ${price} kivi to ${actor.displayName}.`
          });
        }
      }
      return;
    }
    if (actor.kind === 'business') {
      const text = fill(pick(rng, AD_GENERIC), { ...varsFor(actor), suffix: pick(rng, AD_SUFFIX) });
      ev('ad_published', actor.surface, actor.id, { surfaceText: text });
      seenBy(sampleOthers(rng, idsBySurface[actor.surface], new Set([actor.id]), AD_REACH), actor.id, actor.surface, 'Saw an ad.');
      return;
    }
    doPost(actor, actor.surface !== 'facebook');
  }

  function doInvite(actor: WorldAccount): void {
    const mine = groupsBySurface[actor.surface].filter((g) => g.memberIds.includes(actor.id));
    const pool = mine.length > 0 ? mine : groupsBySurface[actor.surface];
    if (pool.length === 0) return;
    const group = pick(rng, pool);
    if (group.memberIds.length >= GROUP_CAP) return;
    const isLegitOutsider = (id: string): boolean => {
      const c = byId.get(id);
      return c !== undefined && c.role === 'legit' && !group.memberIds.includes(id);
    };
    const friends = contactsOf(graph, actor.id).filter(isLegitOutsider);
    const rest = idsBySurface[actor.surface].filter((id) => id !== actor.id && isLegitOutsider(id));
    const cand = friends.length > 0 ? friends : rest;
    if (cand.length === 0) return;
    const target = pick(rng, cand);
    ev('group_invite_sent', actor.surface, actor.id, {
      targetId: target,
      groupId: group.id,
      surfaceText: fill(pick(rng, INVITES), { ...varsFor(actor), group: group.name })
    });
    if (rng() < JOIN_P && group.memberIds.length < GROUP_CAP && !group.memberIds.includes(target)) {
      group.memberIds.push(target);
      ev('group_joined', actor.surface, target, { groupId: group.id, surfaceText: `Joined ${group.name}.` });
    }
  }

  function doPay(actor: WorldAccount): void {
    const pages = [...offers.values()].filter((o) => o.surface === actor.surface);
    if (pages.length === 0) {
      doPost(actor, actor.surface !== 'facebook');
      return;
    }
    const page = pick(rng, pages);
    const pageAcct = byId.get(page.id);
    if (!pageAcct) return;
    ev('payment_attempted', actor.surface, actor.id, {
      targetId: page.id,
      indicators: [{ kind: 'payment_handle', value: `${slug(pageAcct.id)}.pay.example` }],
      claimCodes: [CLAIM_OFFER],
      surfaceText: `Paid ${nextInt(rng, 5, 200)} kivi to ${pageAcct.displayName}.`
    });
  }

  function selectAction(actor: WorldAccount): void {
    const fb = actor.surface === 'facebook';
    const r = rng();
    if (fb) {
      if (r < 0.36) return doPost(actor, false);
      if (r < 0.56) return doReaction(actor);
      if (r < 0.7) return doComment(actor);
      if (r < 0.8) return doMessage(actor);
      if (r < 0.88) return doLink(actor);
      if (r < 0.94) return doAd(actor);
      if (r < 0.99) return doInvite(actor);
      return doPay(actor);
    }
    if (r < 0.6) return doMessage(actor);
    if (r < 0.7) return doLink(actor);
    if (r < 0.78) return doReaction(actor);
    if (r < 0.84) return doPost(actor, true);
    if (r < 0.88) return doAd(actor);
    if (r < 0.92) return doComment(actor);
    if (r < 0.97) return doInvite(actor);
    return doPay(actor);
  }

  for (const actor of state.accounts) {
    const lambda =
      state.rateScale[actor.surface] * (actor.persona.actionsPerDay / 1440) * activityCurve(tick, actor.persona.city.utcOffset, actor.persona.wakeHour);
    if (rng() >= lambda) continue;
    const inboxIdx = state.pending.findIndex((p) => p.to === actor.id);
    if (inboxIdx >= 0 && rng() < REPLY_P) {
      const pm = state.pending[inboxIdx];
      state.pending.splice(inboxIdx, 1);
      const other = byId.get(pm.from);
      if (other) {
        ev('message_sent', actor.surface, actor.id, { targetId: other.id, surfaceText: pick(rng, REPLIES) });
        state.pending.push({ to: other.id, from: actor.id, surface: actor.surface, since: tick });
      }
      continue;
    }
    selectAction(actor);
  }

  const day = Math.floor(tick / 1440);
  const tod = tick % 1440;
  for (const [id] of offers) {
    const pageRng = createRng(hashSeedString(`${state.seed}:offer:${day}:${id}`));
    if (nextInt(pageRng, 1, 1440) === tod) {
      const page = byId.get(id);
      if (page) doAd(page);
    }
  }

  runCampaigns(state, tick, rng, ev);
  runJourneys(state, tick, rng, ev);

  if (state.recoveries.length > 0) {
    const due = state.recoveries.filter((r) => tick >= r.atMinute);
    state.recoveries = state.recoveries.filter((r) => tick < r.atMinute);
    for (const r of due) {
      const acct = byId.get(r.accountId);
      if (acct && acct.role === 'taken_over') {
        acct.role = 'legit';
        ev('account_recovered', acct.surface, acct.id, { surfaceText: 'Account recovered.' });
      }
    }
  }
}

export function advanceMinutes(state: WorldState, n: number): void {
  for (let i = 0; i < n; i++) stepMinute(state);
}
