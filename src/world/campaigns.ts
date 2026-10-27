import { createRng, nextInt } from './rng.js';
import { hashSeedString } from './population.js';
import { contactsOf } from './graph.js';
import type { Surface, Indicator, IndicatorKind } from '../contract.js';
import type {
  WorldAccount,
  WorldGraph,
  WorldState,
  Campaign,
  CampaignStage,
  Operation,
  TemplateKey,
  EventType
} from './types.js';

export interface StageEmitOpts {
  targetId?: string;
  groupId?: string;
  indicators?: Indicator[];
  claimCodes?: string[];
  surfaceText: string;
  payload?: { reason: string };
}

export type StageEmit = (type: EventType, surface: Surface, actorId: string, opts: StageEmitOpts) => string;

export const TEMPLATE_KEYS: TemplateKey[] = [
  'investment-funnel',
  'advance-fee-prize',
  'brand-support',
  'marketplace-diversion',
  'account-recovery',
  'group-investment-room',
  'fake-delivery',
  'romance-investment'
];

interface IndicatorSpec {
  kind: IndicatorKind;
  value: string;
}

interface TemplateSpec {
  key: TemplateKey;
  path: Surface[];
  kind: 'payment' | 'credential';
  amountRange?: [number, number];
  linkHost?: string;
  brand?: string;
  credentialValue?: string;
  publishText: string;
  publishIndicators: IndicatorSpec[];
  publishClaims: string[];
  contactText: string;
  lureText: string;
  requestText: string;
  requestClaims: string[];
}

const TEMPLATES: Record<TemplateKey, TemplateSpec> = {
  'investment-funnel': {
    key: 'investment-funnel',
    path: ['facebook', 'messenger', 'whatsapp'],
    kind: 'payment',
    amountRange: [500, 5000],
    linkHost: 'growth-circle.example',
    publishText: '{city} Growth Circle: members doubled their kivi in 6 weeks. Free entry this week: {link}',
    publishIndicators: [{ kind: 'offplatform_link', value: '{link}' }],
    publishClaims: ['investment'],
    contactText: 'Hi! Saw you liked our circle. I can show you how it starts — no cost to look.',
    lureText: 'Easier to show you here — I sent the dashboard link. It takes 2 minutes.',
    requestText: 'Reserve your circle seat: {amount} kivi to start earning. This round closes tonight.',
    requestClaims: ['investment', 'urgent']
  },
  'advance-fee-prize': {
    key: 'advance-fee-prize',
    path: ['facebook', 'messenger'],
    kind: 'payment',
    amountRange: [20, 100],
    linkHost: 'spring-draw.example',
    publishText: 'You won the {city} Spring Draw! 5000 kivi prize. Claim before Friday: {link}',
    publishIndicators: [
      { kind: 'prize_claim', value: 'Spring Draw prize' },
      { kind: 'urgency_phrase', value: 'Claim before Friday.' },
      { kind: 'offplatform_link', value: '{link}' }
    ],
    publishClaims: ['prize'],
    contactText: 'Congrats! I handle prize releases. Reply here and I will walk you through it.',
    lureText: 'Moving us here so I can send your claim form directly.',
    requestText: 'Release fee {amount} kivi unlocks your 5000 kivi prize.',
    requestClaims: ['prize', 'urgent']
  },
  'brand-support': {
    key: 'brand-support',
    path: ['messenger', 'whatsapp'],
    kind: 'credential',
    linkHost: 'kiverpay-secure.example',
    brand: 'KiverPay Security',
    credentialValue: 'wallet seed phrase',
    publishText: 'KiverPay Security: unusual login on your wallet. Verify now to stay safe: {link}',
    publishIndicators: [
      { kind: 'impersonated_brand', value: 'KiverPay Security' },
      { kind: 'urgency_phrase', value: 'Verify now to stay safe.' },
      { kind: 'offplatform_link', value: '{link}' }
    ],
    publishClaims: ['support', 'account-alert'],
    contactText: 'KiverPay support following up. Did you get the alert?',
    lureText: 'Continue verification here — reply with the code we sent.',
    requestText: 'Confirm your wallet seed phrase to finish verification.',
    requestClaims: ['support', 'account-alert']
  },
  'marketplace-diversion': {
    key: 'marketplace-diversion',
    path: ['facebook', 'whatsapp'],
    kind: 'payment',
    amountRange: [50, 500],
    linkHost: 'market-direct.example',
    publishText: '{Product} at half price. Pay direct and skip market fees: {handle}',
    publishIndicators: [
      { kind: 'payment_handle', value: '{handle}' },
      { kind: 'offplatform_link', value: '{link}' }
    ],
    publishClaims: ['offer'],
    contactText: 'Yes, still available! I can hold it if you pay direct today.',
    lureText: 'Easier here — send the {amount} kivi to {handle} and I ship tomorrow.',
    requestText: 'Send {amount} kivi to {handle} to lock it in. Someone else asked about it — decide tonight.',
    requestClaims: ['offer', 'urgent']
  },
  'account-recovery': {
    key: 'account-recovery',
    path: ['whatsapp'],
    kind: 'credential',
    linkHost: 'telmora-post.example',
    brand: 'Telmora Post',
    credentialValue: '6-digit code',
    publishText: 'Telmora Post: your account locks in 24h. Recover here: {link}',
    publishIndicators: [
      { kind: 'impersonated_brand', value: 'Telmora Post' },
      { kind: 'urgency_phrase', value: 'Your account locks in 24h.' },
      { kind: 'offplatform_link', value: '{link}' }
    ],
    publishClaims: ['account-alert'],
    contactText: 'Recovery desk here. Reply START and I will unlock your case.',
    lureText: 'Almost done — I need one code from you.',
    requestText: 'Enter the 6-digit code to recover.',
    requestClaims: ['account-alert']
  },
  'group-investment-room': {
    key: 'group-investment-room',
    path: ['whatsapp'],
    kind: 'payment',
    amountRange: [100, 1000],
    publishText: 'Ostbridge Wealth Room: free signals, 40 members already inside.',
    publishIndicators: [{ kind: 'urgency_phrase', value: 'Seats fill fast.' }],
    publishClaims: ['investment'],
    contactText: 'Saw your interest! The room opens to new members today.',
    lureText: 'Join the room — entry is {amount} kivi after you look around.',
    requestText: 'Room entry {amount} kivi. Signals start tonight.',
    requestClaims: ['investment', 'urgent']
  },
  'fake-delivery': {
    key: 'fake-delivery',
    path: ['facebook', 'messenger'],
    kind: 'payment',
    amountRange: [5, 25],
    linkHost: 'telmora-post.example',
    brand: 'Telmora Post',
    publishText: 'Telmora Post: parcel held at depot. Pay {amount} kivi redelivery: {link}',
    publishIndicators: [
      { kind: 'impersonated_brand', value: 'Telmora Post' },
      { kind: 'payment_handle', value: '{handle}' },
      { kind: 'urgency_phrase', value: 'Parcel held at depot.' }
    ],
    publishClaims: ['delivery'],
    contactText: 'Customs needs the fee before release. I can push it through today.',
    lureText: 'Pay here and send the receipt — drivers leave at six.',
    requestText: 'Redelivery fee {amount} kivi.',
    requestClaims: ['delivery', 'urgent']
  },
  'romance-investment': {
    key: 'romance-investment',
    path: ['messenger', 'whatsapp'],
    kind: 'payment',
    amountRange: [200, 2000],
    publishText: 'New here! Love {interest} and long walks. Say hi?',
    publishIndicators: [],
    publishClaims: [],
    contactText: 'Thanks for the add! How long have you been into {interest}?',
    lureText: 'I use whatsapp more — talk there instead?',
    requestText: 'My uncle trades kivi... put in {amount}, we split the gains.',
    requestClaims: ['investment']
  }
};

const STAGE_DELAYS: Record<CampaignStage, [number, number]> = {
  publish: [5, 30],
  exposure: [20, 120],
  contact: [20, 180],
  lure: [30, 240],
  request: [30, 240],
  cashout: [60, 480]
};

const NEXT_STAGE: Record<CampaignStage, CampaignStage | null> = {
  publish: 'exposure',
  exposure: 'contact',
  contact: 'lure',
  lure: 'request',
  request: 'cashout',
  cashout: null
};

const VICTIM_REPLIES = ['tell me more', 'ok', 'is this real?', 'who is this?', 'go on'];
const PRODUCT_SUFFIX = ['kit', 'guide', 'bundle', 'workshop pass'];
const CASHOUT_RATE = 0.35;
const REPORT_RATE = 0.5;
const RECOVERY_DELAY: [number, number] = [1440, 4320];

export const WARNING_REASON = 'this contact may be a scam';

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

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[nextInt(rng, 0, arr.length)];
}

export function formOperations(accounts: WorldAccount[]): Operation[] {
  const ops = accounts
    .filter((a) => a.role === 'operator')
    .map((a) => a.id)
    .sort();
  const shells = accounts
    .filter((a) => a.role === 'shell')
    .map((a) => a.id)
    .sort();
  const groups: string[][] = [[], [], [], []];
  ops.forEach((id, i) => groups[i % 4].push(id));
  shells.forEach((id, i) => groups[i % 4].push(id));
  return groups.map((memberIds, i) => ({ id: `OP-${i + 1}`, memberIds: [...memberIds].sort() }));
}

function pickTarget(
  rng: () => number,
  accounts: WorldAccount[],
  graph: WorldGraph,
  opMemberIds: Set<string>,
  path: Surface[]
): { targetPersonId: string; entryAccountId: string } | null {
  const first = path[0];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const opNeighbors = new Set<string>();
  for (const e of graph.contactEdges) {
    if (e.surface !== first) continue;
    if (opMemberIds.has(e.a) && !opMemberIds.has(e.b)) opNeighbors.add(e.b);
    else if (opMemberIds.has(e.b) && !opMemberIds.has(e.a)) opNeighbors.add(e.a);
  }
  const byPerson = new Map<string, WorldAccount[]>();
  for (const a of accounts) {
    const list = byPerson.get(a.personId);
    if (list) list.push(a);
    else byPerson.set(a.personId, [a]);
  }
  const candidates: Array<{ personId: string; entryAccountId: string }> = [];
  for (const [pid, accts] of byPerson) {
    if (!accts.every((a) => a.role === 'legit')) continue;
    const surfaces = new Set(accts.map((a) => a.surface));
    if (!path.every((s) => surfaces.has(s))) continue;
    const mine = accts.find((a) => a.surface === first);
    if (!mine || !opNeighbors.has(mine.id)) continue;
    const entry = contactsOf(graph, mine.id).find((id) => opMemberIds.has(id));
    if (!entry) continue;
    candidates.push({ personId: pid, entryAccountId: entry });
  }
  candidates.sort((x, y) => (x.personId < y.personId ? -1 : 1));
  if (candidates.length === 0) return null;
  const chosen = candidates[nextInt(rng, 0, candidates.length)];
  return { targetPersonId: chosen.personId, entryAccountId: chosen.entryAccountId };
}

export function spawnCampaigns(seed: number, accounts: WorldAccount[], graph: WorldGraph, operations: Operation[]): Campaign[] {
  const out: Campaign[] = [];
  operations.forEach((op, i) => {
    const rng = createRng(hashSeedString(`${seed}:campaign:${op.id}`));
    const templateKey = TEMPLATE_KEYS[nextInt(rng, 0, TEMPLATE_KEYS.length)];
    const spec = TEMPLATES[templateKey];
    const target = pickTarget(rng, accounts, graph, new Set(op.memberIds), spec.path);
    if (!target) return;
    const startedAt = i * 45;
    const [lo, hi] = STAGE_DELAYS.publish;
    const amount = spec.amountRange ? nextInt(rng, spec.amountRange[0], spec.amountRange[1] + 1) : undefined;
    out.push({
      id: `CMP-0${i + 1}`,
      templateKey,
      operationId: op.id,
      stage: 'publish',
      path: [...spec.path],
      startedAt,
      targetPersonId: target.targetPersonId,
      entryAccountId: target.entryAccountId,
      currentActorId: target.entryAccountId,
      nextAt: startedAt + nextInt(rng, lo, hi + 1),
      trail: [],
      ...(amount !== undefined ? { amount } : {}),
      outcome: null
    });
  });
  return out;
}

function victimAccountOn(accounts: WorldAccount[], personId: string, surface: Surface): WorldAccount | undefined {
  return accounts.find((a) => a.personId === personId && a.surface === surface);
}

function pickHopAccount(
  graph: WorldGraph,
  opMemberIds: string[],
  byId: Map<string, WorldAccount>,
  targetSurface: Surface,
  currentActorId: string,
  victimAccountId: string
): WorldAccount | null {
  const current = byId.get(currentActorId);
  if (!current) return null;
  const cands = opMemberIds
    .map((id) => byId.get(id))
    .filter((a): a is WorldAccount => a !== undefined && a.surface === targetSurface && a.id !== currentActorId && a.personId !== current.personId)
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  if (cands.length === 0) return null;
  const neighbors = new Set(contactsOf(graph, victimAccountId));
  return cands.find((a) => neighbors.has(a.id)) ?? cands[0];
}

function hasEdge(graph: WorldGraph, a: string, b: string): boolean {
  return contactsOf(graph, a).includes(b);
}

interface RunCtx {
  state: WorldState;
  tick: number;
  rng: () => number;
  emit: StageEmit;
  byId: Map<string, WorldAccount>;
  opMembers: Map<string, string[]>;
}

function sendMessage(ctx: RunCtx, fromId: string, toId: string, surface: Surface, text: string, extra: Indicator[] = []): void {
  const indicators: Indicator[] = [...extra];
  if (!hasEdge(ctx.state.graph, fromId, toId)) {
    indicators.push({ kind: 'unsolicited_contact', value: 'stranger message' });
  }
  ctx.emit('message_sent', surface, fromId, { targetId: toId, indicators, surfaceText: text });
  ctx.state.pending.push({ to: toId, from: fromId, surface, since: ctx.tick });
}

function victimReply(ctx: RunCtx, victimId: string, operatorId: string, surface: Surface): void {
  const text = pick(ctx.rng, VICTIM_REPLIES);
  const indicators: Indicator[] = [];
  if (!hasEdge(ctx.state.graph, victimId, operatorId)) {
    indicators.push({ kind: 'unsolicited_contact', value: 'stranger message' });
  }
  ctx.emit('message_sent', surface, victimId, { targetId: operatorId, indicators, surfaceText: text });
  ctx.state.pending.push({ to: operatorId, from: victimId, surface, since: ctx.tick });
}

function opHandle(actorId: string): string {
  return `${slug(actorId)}.pay.example`;
}

function lureSurfaceOf(c: Campaign): Surface {
  return c.path[1] ?? c.path[0];
}

function runStage(ctx: RunCtx, c: Campaign): void {
  const spec = TEMPLATES[c.templateKey];
  const tick = ctx.tick;
  const trail = (surface: Surface, actorId: string): void => {
    c.trail.push({ stage: c.stage, surface, actorId, atMinute: tick });
  };
  const scheduleNext = (): void => {
    const next = NEXT_STAGE[c.stage];
    if (!next) {
      c.nextAt = null;
      return;
    }
    const [lo, hi] = STAGE_DELAYS[next];
    c.nextAt = tick + nextInt(ctx.rng, lo, hi + 1);
    c.stage = next;
  };
  const victimOn = (surface: Surface): WorldAccount | undefined => victimAccountOn(ctx.state.accounts, c.targetPersonId, surface);
  const varsFor = (victim: WorldAccount): Record<string, string> => {
    const interest = pick(ctx.rng, victim.persona.interests);
    return {
      interest,
      Interest: capitalize(interest),
      city: victim.persona.city.name,
      link: spec.linkHost ? `${spec.linkHost}/${nextInt(ctx.rng, 100, 999)}` : '',
      handle: opHandle(c.currentActorId),
      amount: c.amount !== undefined ? String(c.amount) : '',
      Product: `${capitalize(interest)} ${pick(ctx.rng, PRODUCT_SUFFIX)}`
    };
  };

  if (c.stage === 'publish') {
    const surface = c.path[0];
    const victim = victimOn(surface);
    if (!victim) {
      c.outcome = 'stalled';
      c.nextAt = null;
      return;
    }
    const vars = varsFor(victim);
    const indicators: Indicator[] = spec.publishIndicators.map((s) => ({ kind: s.kind, value: fill(s.value, vars) }) as Indicator);
    ctx.emit('ad_published', surface, c.currentActorId, {
      indicators,
      claimCodes: [...spec.publishClaims],
      surfaceText: fill(spec.publishText, vars)
    });
    trail(surface, c.currentActorId);
    scheduleNext();
    return;
  }

  if (c.stage === 'exposure') {
    const surface = c.path[0];
    const victim = victimOn(surface);
    if (!victim) {
      c.outcome = 'stalled';
      c.nextAt = null;
      return;
    }
    ctx.emit('post_seen', surface, victim.id, { targetId: c.currentActorId, surfaceText: 'Saw an ad.' });
    trail(surface, victim.id);
    scheduleNext();
    return;
  }

  if (c.stage === 'contact') {
    const surface = c.path[0];
    const victim = victimOn(surface);
    if (!victim) {
      c.outcome = 'stalled';
      c.nextAt = null;
      return;
    }
    sendMessage(ctx, c.currentActorId, victim.id, surface, fill(spec.contactText, varsFor(victim)));
    victimReply(ctx, victim.id, c.currentActorId, surface);
    trail(surface, c.currentActorId);
    scheduleNext();
    return;
  }

  if (c.stage === 'lure') {
    const surface = lureSurfaceOf(c);
    const victim = victimOn(surface);
    if (!victim) {
      c.outcome = 'stalled';
      c.nextAt = null;
      return;
    }
    if (surface !== c.path[0]) {
      const members = ctx.opMembers.get(c.operationId) ?? [];
      const hop = pickHopAccount(ctx.state.graph, members, ctx.byId, surface, c.currentActorId, victim.id);
      if (!hop) {
        c.outcome = 'stalled';
        c.nextAt = null;
        return;
      }
      c.currentActorId = hop.id;
    }
    const vars = varsFor(victim);
    if (c.templateKey === 'group-investment-room') {
      const rooms = ctx.state.graph.groups.filter((g) => g.surface === surface);
      if (rooms.length > 0) {
        const room = rooms[nextInt(ctx.rng, 0, rooms.length)];
        ctx.emit('group_invite_sent', surface, c.currentActorId, {
          targetId: victim.id,
          groupId: room.id,
          claimCodes: ['investment'],
          surfaceText: `Join ${room.name}! Free signals inside.`
        });
        if (!room.memberIds.includes(victim.id) && room.memberIds.length < 40) {
          room.memberIds.push(victim.id);
          ctx.emit('group_joined', surface, victim.id, { groupId: room.id, surfaceText: `Joined ${room.name}.` });
        }
      }
    }
    sendMessage(ctx, c.currentActorId, victim.id, surface, fill(spec.lureText, vars));
    victimReply(ctx, victim.id, c.currentActorId, surface);
    trail(surface, c.currentActorId);
    scheduleNext();
    return;
  }

  if (c.stage === 'request') {
    const surface = lureSurfaceOf(c);
    const victim = victimOn(surface);
    if (!victim) {
      c.outcome = 'stalled';
      c.nextAt = null;
      return;
    }
    const vars = varsFor(victim);
    if (spec.kind === 'payment') {
      const handle = opHandle(c.currentActorId);
      ctx.emit('payment_request_shown', surface, victim.id, {
        targetId: c.currentActorId,
        indicators: [{ kind: 'payment_handle', value: handle }],
        claimCodes: [...spec.requestClaims],
        surfaceText: `Payment request from ${ctx.byId.get(c.currentActorId)?.displayName ?? 'unknown'}: ${vars.amount} kivi.`
      });
    } else {
      ctx.emit('credential_request_shown', surface, victim.id, {
        targetId: c.currentActorId,
        indicators: [
          { kind: 'credential_request', value: spec.credentialValue ?? 'login' },
          { kind: 'impersonated_brand', value: spec.brand ?? 'support' }
        ],
        claimCodes: [...spec.requestClaims],
        surfaceText: fill(spec.requestText, vars)
      });
    }
    sendMessage(ctx, c.currentActorId, victim.id, surface, fill(spec.requestText, vars));
    if (ctx.rng() < victim.persona.gullibility * CASHOUT_RATE) {
      c.verdict = 'comply';
    } else if (ctx.rng() < victim.persona.vigilance * REPORT_RATE) {
      c.verdict = 'report';
    } else {
      c.verdict = 'ignore';
    }
    if (ctx.rng() < 1 - victim.persona.vigilance / 1.4) {
      ctx.emit('warning_shown', surface, victim.id, {
        targetId: c.currentActorId,
        surfaceText: 'This contact may be a scam.',
        payload: { reason: WARNING_REASON }
      });
    }
    trail(surface, c.currentActorId);
    scheduleNext();
    return;
  }

  const surface = c.path[c.path.length - 1];
  const victim = victimOn(surface);
  if (!victim) {
    c.outcome = 'stalled';
    c.nextAt = null;
    return;
  }
  if (surface !== lureSurfaceOf(c)) {
    const members = ctx.opMembers.get(c.operationId) ?? [];
    const hop = pickHopAccount(ctx.state.graph, members, ctx.byId, surface, c.currentActorId, victim.id);
    if (!hop) {
      c.outcome = 'stalled';
      c.nextAt = null;
      return;
    }
    c.currentActorId = hop.id;
  }
  trail(surface, c.currentActorId);
  if (c.verdict === 'comply') {
    if (spec.kind === 'payment') {
      ctx.emit('payment_attempted', surface, victim.id, {
        targetId: c.currentActorId,
        indicators: [{ kind: 'payment_handle', value: opHandle(c.currentActorId) }],
        claimCodes: [...spec.requestClaims],
        surfaceText: `Paid ${c.amount ?? 0} kivi.`
      });
    } else {
      ctx.emit('account_taken_over', surface, victim.id, {
        targetId: c.currentActorId,
        indicators: [{ kind: 'credential_request', value: spec.credentialValue ?? 'login' }],
        claimCodes: [...spec.requestClaims],
        surfaceText: 'Account access granted.'
      });
      victim.role = 'taken_over';
      ctx.state.recoveries.push({
        accountId: victim.id,
        atMinute: tick + nextInt(ctx.rng, RECOVERY_DELAY[0], RECOVERY_DELAY[1] + 1)
      });
    }
    c.outcome = 'cashed_out';
  } else if (c.verdict === 'report') {
    c.outcome = 'reported';
  } else {
    c.outcome = 'stalled';
  }
  c.nextAt = null;
}

export function runCampaigns(state: WorldState, tick: number, rng: () => number, emit: StageEmit): void {
  if (state.campaigns.length === 0) return;
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const opMembers = new Map(state.operations.map((o) => [o.id, o.memberIds]));
  const recording: StageEmit = (type, surface, actorId, opts) => {
    const id = emit(type, surface, actorId, opts);
    state.truthLog.push(id);
    return id;
  };
  const ctx: RunCtx = { state, tick, rng, emit: recording, byId, opMembers };
  for (const c of state.campaigns) {
    if (c.outcome != null || c.nextAt == null || tick < c.nextAt) continue;
    runStage(ctx, c);
  }
}
