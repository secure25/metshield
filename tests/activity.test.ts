import { describe, expect, it } from 'vitest';
import { createWorldState } from '../src/world/state.js';
import { advanceMinutes, offerPages, BOOT_MINUTES } from '../src/world/activity.js';
import { contactsOf } from '../src/world/graph.js';

const TYPES = new Set([
  'ad_published',
  'post_published',
  'post_seen',
  'reaction_added',
  'comment_posted',
  'message_sent',
  'group_invite_sent',
  'group_joined',
  'link_shared',
  'payment_request_shown',
  'credential_request_shown',
  'payment_attempted',
  'account_taken_over',
  'account_recovered',
  'warning_shown'
]);

describe('activity', () => {
  it('produces roughly 900-1300 events per simulated hour', () => {
    const rates: number[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = createWorldState(seed);
      advanceMinutes(state, 1440 - BOOT_MINUTES);
      expect(state.tick).toBe(1440);
      const perHour = state.events.length / 24;
      console.log(`seed ${seed}: ${state.events.length} events, ${perHour.toFixed(1)}/hour`);
      rates.push(perHour);
    }
    for (const perHour of rates) {
      expect(perHour).toBeGreaterThanOrEqual(900);
      expect(perHour).toBeLessThanOrEqual(1300);
    }
  });

  it('sends messages over mutual edges with replies on both ends', () => {
    // Correction: the old expectation (every message has a mutual edge) is wrong
    // because cold first contact is a designed phenomenon — cross-surface campaign
    // hops message victims where no edge can be assumed. Such conversations carry
    // the unsolicited_contact indicator from their first message, so the corrected
    // rule is: conversations that started cold stay cold; every other message
    // needs its mutual edge. Same-surface still holds for all messages.
    const state = createWorldState(7);
    const g = state.graph;
    const byId = new Map(state.accounts.map((a) => [a.id, a]));
    const msgs = state.events.filter((e) => e.type === 'message_sent');
    expect(msgs.length).toBeGreaterThan(0);
    const pairKey = (m: (typeof msgs)[number]): string => [m.actorId, m.targetId ?? ''].sort().join('>');
    const firstByPair = new Map<string, (typeof msgs)[number]>();
    for (const m of msgs) {
      const k = pairKey(m);
      if (!firstByPair.has(k)) firstByPair.set(k, m);
    }
    const coldPair = (m: (typeof msgs)[number]): boolean =>
      firstByPair.get(pairKey(m))?.indicators.some((i) => i.kind === 'unsolicited_contact') ?? false;
    for (const m of msgs) {
      expect(m.targetId).toBeDefined();
      expect(byId.get(m.actorId)?.surface).toBe(byId.get(m.targetId ?? '')?.surface);
      if (!coldPair(m)) {
        expect(contactsOf(g, m.actorId)).toContain(m.targetId);
      }
    }
    const pairs = new Set(msgs.map((m) => `${m.actorId}>${m.targetId}`));
    let bidi = 0;
    for (const m of msgs) {
      if (pairs.has(`${m.targetId}>${m.actorId}`)) bidi++;
    }
    expect(bidi).toBeGreaterThan(0);
  });

  it('gives every event a valid actor on the right surface, ordered seq, and text', () => {
    const state = createWorldState(11);
    const byId = new Map(state.accounts.map((a) => [a.id, a]));
    const groupIds = new Set(state.graph.groups.map((g) => g.id));
    let lastSeq = 0;
    const ids = new Set<string>();
    for (const e of state.events) {
      expect(TYPES.has(e.type)).toBe(true);
      const actor = byId.get(e.actorId);
      expect(actor).toBeDefined();
      expect(e.surface).toBe(actor?.surface);
      if (e.targetId !== undefined) expect(byId.has(e.targetId)).toBe(true);
      if (e.groupId !== undefined) expect(groupIds.has(e.groupId)).toBe(true);
      expect(e.surfaceText.length).toBeGreaterThan(0);
      expect(e.seq).toBeGreaterThan(lastSeq);
      lastSeq = e.seq;
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
      expect(e.simMinute).toBeGreaterThanOrEqual(1);
      expect(e.simMinute).toBeLessThanOrEqual(state.tick);
    }
  });

  it('runs benign commerce on 6 offer pages, two with urgency language', () => {
    const state = createWorldState(7);
    const offers = offerPages(state.accounts);
    expect(offers).toHaveLength(6);
    expect(offers.filter((o) => o.urgency)).toHaveLength(2);
    advanceMinutes(state, 2880 - BOOT_MINUTES);
    const ads = state.events.filter((e) => e.type === 'ad_published');
    const offerAds = ads.filter((a) => a.claimCodes.includes('offer'));
    expect(offerAds.length).toBeGreaterThan(0);
    for (const a of offerAds) {
      const ph = a.indicators.find((i) => i.kind === 'payment_handle');
      expect(ph).toBeDefined();
      expect(ph?.value ?? '').toMatch(/\.example$/);
    }
    const urg = offerAds.filter((a) => a.indicators.some((i) => i.kind === 'urgency_phrase'));
    expect(urg.length).toBeGreaterThan(0);
    expect(state.events.some((e) => e.type === 'payment_attempted')).toBe(true);
  });

  it('replays identically for the same seed and advance', () => {
    const a = createWorldState(99);
    const b = createWorldState(99);
    advanceMinutes(a, 30);
    advanceMinutes(b, 30);
    expect(a.events).toEqual(b.events);
    expect(a.tick).toBe(b.tick);
  });
});
