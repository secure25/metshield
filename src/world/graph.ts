import { createRng, nextInt, shuffle } from './rng.js';
import { hashSeedString, CITIES, INTERESTS } from './population.js';
import type { Surface } from '../contract.js';
import type { WorldAccount, WorldGraph } from './types.js';

const SURFACES: Surface[] = ['facebook', 'whatsapp', 'messenger'];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function contactsOf(graph: WorldGraph, accountId: string): string[] {
  const out: string[] = [];
  for (const e of graph.contactEdges) {
    if (e.a === accountId) out.push(e.b);
    else if (e.b === accountId) out.push(e.a);
  }
  return out;
}

export function closeTiesOf(graph: WorldGraph, accountId: string): string[] {
  const out: string[] = [];
  for (const e of graph.contactEdges) {
    if (!e.close) continue;
    if (e.a === accountId) out.push(e.b);
    else if (e.b === accountId) out.push(e.a);
  }
  return out;
}

export function followersOf(graph: WorldGraph, pageId: string): string[] {
  const out: string[] = [];
  for (const e of graph.followEdges) {
    if (e.pageId === pageId) out.push(e.followerId);
  }
  return out;
}

interface TwoSurface {
  personId: string;
  surfaces: [Surface, Surface];
  accts: WorldAccount[];
}

export function generateGraph(seed: number, accounts: WorldAccount[]): WorldGraph {
  const rng = createRng(hashSeedString(`${seed}:graph`));

  const bySurface: Record<Surface, WorldAccount[]> = { facebook: [], whatsapp: [], messenger: [] };
  for (const a of accounts) bySurface[a.surface].push(a);

  const byPerson = new Map<string, WorldAccount[]>();
  for (const a of accounts) {
    const list = byPerson.get(a.personId);
    if (list) list.push(a);
    else byPerson.set(a.personId, [a]);
  }

  const contactEdges: WorldGraph['contactEdges'] = [];
  const pairKeys = new Set<string>();
  const adj = new Map<string, Set<string>>();
  const closeCount = new Map<string, number>();
  const acqCount = new Map<string, number>();
  for (const a of accounts) {
    adj.set(a.id, new Set());
    closeCount.set(a.id, 0);
    acqCount.set(a.id, 0);
  }
  const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

  function addContact(x: string, y: string, surface: Surface, close: boolean): boolean {
    if (x === y) return false;
    const k = pairKey(x, y);
    if (pairKeys.has(k)) return false;
    pairKeys.add(k);
    contactEdges.push({ a: x < y ? x : y, b: x < y ? y : x, surface, close });
    adj.get(x)?.add(y);
    adj.get(y)?.add(x);
    if (close) {
      closeCount.set(x, (closeCount.get(x) ?? 0) + 1);
      closeCount.set(y, (closeCount.get(y) ?? 0) + 1);
    } else {
      acqCount.set(x, (acqCount.get(x) ?? 0) + 1);
      acqCount.set(y, (acqCount.get(y) ?? 0) + 1);
    }
    return true;
  }

  const closeTarget = new Map<string, number>();
  const acqTarget = new Map<string, number>();
  for (const a of accounts) {
    closeTarget.set(a.id, nextInt(rng, 2, 5));
    acqTarget.set(a.id, nextInt(rng, 4, 10));
  }

  const bridges: WorldGraph['bridges'] = {};
  const two: TwoSurface[] = [];
  const three: string[] = [];
  for (const [pid, accts] of byPerson) {
    const surfs = [...new Set(accts.map((a) => a.surface))].sort();
    if (surfs.length === 2) two.push({ personId: pid, surfaces: [surfs[0], surfs[1]], accts });
    else if (surfs.length === 3) three.push(pid);
  }
  three.sort();

  function linkBridge(P: TwoSurface, Q: { personId: string; accts: WorldAccount[] }): void {
    const [A, B] = P.surfaces;
    const pA = P.accts.find((a) => a.surface === A) as WorldAccount;
    const pB = P.accts.find((a) => a.surface === B) as WorldAccount;
    const qA = Q.accts.find((a) => a.surface === A) as WorldAccount;
    const qB = Q.accts.find((a) => a.surface === B) as WorldAccount;
    addContact(pA.id, qA.id, A, true);
    addContact(pB.id, qB.id, B, true);
    bridges[P.personId] = {
      otherPersonId: Q.personId,
      surfaces: [A, B],
      myAccounts: [pA.id, pB.id],
      theirAccounts: [qA.id, qB.id]
    };
    bridges[Q.personId] = {
      otherPersonId: P.personId,
      surfaces: [A, B],
      myAccounts: [qA.id, qB.id],
      theirAccounts: [pA.id, pB.id]
    };
  }

  const pairGroups = new Map<string, TwoSurface[]>();
  for (const t of two) {
    const key = t.surfaces.join('|');
    const list = pairGroups.get(key);
    if (list) list.push(t);
    else pairGroups.set(key, [t]);
  }
  const leftovers: TwoSurface[] = [];
  for (const members of pairGroups.values()) {
    members.sort((x, y) => (x.personId < y.personId ? -1 : 1));
    for (let i = 0; i + 1 < members.length; i += 2) linkBridge(members[i], members[i + 1]);
    if (members.length % 2 === 1) leftovers.push(members[members.length - 1]);
  }
  leftovers.sort((x, y) => (x.personId < y.personId ? -1 : 1));
  for (let i = 0; i < leftovers.length; i++) {
    const qpid = three[i];
    if (qpid === undefined) continue;
    const qaccts = byPerson.get(qpid);
    if (!qaccts) continue;
    linkBridge(leftovers[i], { personId: qpid, accts: qaccts });
  }

  function candidatesFor(id: string, members: WorldAccount[]): WorldAccount[] {
    const seen = adj.get(id);
    return members.filter((m) => m.id !== id && !seen?.has(m.id));
  }

  function topUp(surface: Surface, close: boolean): void {
    const members = bySurface[surface];
    const counts = close ? closeCount : acqCount;
    const targets = close ? closeTarget : acqTarget;
    for (const m of members) {
      while ((counts.get(m.id) ?? 0) < (targets.get(m.id) ?? 0)) {
        const cand = candidatesFor(m.id, members);
        if (cand.length === 0) break;
        const under = cand.filter((c) => (counts.get(c.id) ?? 0) < (targets.get(c.id) ?? 0));
        const pool = under.length > 0 ? under : cand;
        const partner = pool[nextInt(rng, 0, pool.length)];
        if (!addContact(m.id, partner.id, surface, close)) break;
      }
    }
  }

  for (const s of SURFACES) {
    topUp(s, true);
    topUp(s, false);
  }

  const followEdges: WorldGraph['followEdges'] = [];
  for (const s of SURFACES) {
    const legitPool = bySurface[s].filter((a) => a.role === 'legit');
    for (const page of bySurface[s].filter((a) => a.kind === 'business')) {
      const n = nextInt(rng, 30, 61);
      const pool = legitPool.filter((a) => a.id !== page.id);
      const cp = [...pool];
      shuffle(rng, cp);
      for (const f of cp.slice(0, Math.min(n, pool.length))) {
        followEdges.push({ pageId: page.id, followerId: f.id, surface: s });
      }
    }
  }

  const groups: WorldGraph['groups'] = [];
  const usedNames = new Set<string>();
  const SUFFIX = ['Club', 'Circle', 'Society', 'Group'];
  for (const s of SURFACES) {
    for (let gi = 0; gi < 4; gi++) {
      const n = nextInt(rng, 12, 41);
      const pool = bySurface[s].filter((a) => a.role === 'legit');
      const cp = [...pool];
      shuffle(rng, cp);
      const memberIds = cp.slice(0, Math.min(n, pool.length)).map((a) => a.id);
      let name = '';
      let topic = INTERESTS[0];
      for (let att = 0; att < 20; att++) {
        const city = CITIES[nextInt(rng, 0, CITIES.length)].name;
        const interest = INTERESTS[nextInt(rng, 0, INTERESTS.length)];
        const suf = SUFFIX[nextInt(rng, 0, SUFFIX.length)];
        const cand = `${city} ${capitalize(interest)} ${suf}`;
        if (!usedNames.has(cand)) {
          name = cand;
          topic = interest;
          break;
        }
      }
      if (name === '') {
        topic = INTERESTS[(gi + SURFACES.indexOf(s) * 4) % INTERESTS.length];
        name = `${capitalize(s)} ${capitalize(topic)} ${gi + 1}`;
      }
      usedNames.add(name);
      groups.push({ id: `GRP-${s}-${gi + 1}`, surface: s, name, topic, memberIds });
    }
  }

  return { contactEdges, followEdges, groups, bridges };
}
