import { describe, expect, it } from 'vitest';
import { createWorldState } from '../src/world/state.js';
import { contactsOf, closeTiesOf, followersOf } from '../src/world/graph.js';
import type { WorldAccount } from '../src/world/types.js';

const SEEDS = [1, 2, 3, 4, 5];

describe('graph', () => {
  it('stores every contact edge once, mutual from both ends; close ties are a subset of contacts', () => {
    for (const seed of SEEDS) {
      const state = createWorldState(seed);
      const g = state.graph;
      const keys = g.contactEdges.map((e) => `${e.a}|${e.b}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const e of g.contactEdges) {
        expect(e.a < e.b).toBe(true);
        expect(contactsOf(g, e.a)).toContain(e.b);
        expect(contactsOf(g, e.b)).toContain(e.a);
      }
      for (const a of state.accounts) {
        const contacts = contactsOf(g, a.id);
        const close = closeTiesOf(g, a.id);
        for (const c of close) expect(contacts).toContain(c);
        expect(close.length).toBeGreaterThanOrEqual(2);
        expect(contacts.length - close.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('gives every two-surface person a mutual tie present on both surfaces', () => {
    for (const seed of SEEDS) {
      const state = createWorldState(seed);
      const g = state.graph;
      const byPerson = new Map<string, WorldAccount[]>();
      for (const a of state.accounts) {
        const list = byPerson.get(a.personId);
        if (list) list.push(a);
        else byPerson.set(a.personId, [a]);
      }
      let twoCount = 0;
      for (const [pid, accts] of byPerson) {
        const surfs = [...new Set(accts.map((a) => a.surface))].sort();
        if (surfs.length !== 2) continue;
        twoCount++;
        const tie = g.bridges[pid];
        if (tie === undefined) throw new Error(`seed ${seed} person ${pid} has no bridge`);
        expect([...tie.surfaces].sort()).toEqual(surfs);
        for (let i = 0; i < 2; i++) {
          const s = tie.surfaces[i];
          const mine = accts.find((a) => a.surface === s);
          expect(tie.myAccounts[i]).toBe(mine?.id);
          const theirs = state.accounts.find((a) => a.id === tie.theirAccounts[i]);
          expect(theirs?.surface).toBe(s);
          expect(theirs?.personId).toBe(tie.otherPersonId);
          expect(contactsOf(g, tie.myAccounts[i])).toContain(tie.theirAccounts[i]);
          expect(contactsOf(g, tie.theirAccounts[i])).toContain(tie.myAccounts[i]);
        }
        expect(g.bridges[tie.otherPersonId]?.otherPersonId).toBe(pid);
      }
      expect(twoCount).toBeGreaterThan(0);
    }
  });

  it('has 4 non-empty groups per surface sized 12-40 from the legitimate pool', () => {
    for (const seed of SEEDS) {
      const state = createWorldState(seed);
      const g = state.graph;
      expect(g.groups).toHaveLength(12);
      for (const s of ['facebook', 'whatsapp', 'messenger'] as const) {
        expect(g.groups.filter((x) => x.surface === s)).toHaveLength(4);
      }
      expect(new Set(g.groups.map((x) => x.id)).size).toBe(12);
      const byId = new Map(state.accounts.map((a) => [a.id, a]));
      for (const grp of g.groups) {
        expect(grp.name.length).toBeGreaterThan(0);
        expect(grp.topic.length).toBeGreaterThan(0);
        expect(grp.memberIds.length).toBeGreaterThanOrEqual(12);
        expect(grp.memberIds.length).toBeLessThanOrEqual(40);
        expect(new Set(grp.memberIds).size).toBe(grp.memberIds.length);
        for (const mid of grp.memberIds) {
          const m = byId.get(mid);
          expect(m?.surface).toBe(grp.surface);
          expect(m?.role).toBe('legit');
        }
      }
    }
  });

  it('gives business pages 30-60 one-way followers from the legitimate pool', () => {
    const state = createWorldState(7);
    const g = state.graph;
    const byId = new Map(state.accounts.map((a) => [a.id, a]));
    const pages = state.accounts.filter((a) => a.kind === 'business');
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      const fols = followersOf(g, p.id);
      expect(fols.length).toBeGreaterThanOrEqual(30);
      expect(fols.length).toBeLessThanOrEqual(60);
      expect(new Set(fols).size).toBe(fols.length);
      for (const fid of fols) {
        const f = byId.get(fid);
        expect(f?.surface).toBe(p.surface);
        expect(f?.role).toBe('legit');
      }
    }
  });
});
