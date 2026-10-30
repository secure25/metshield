import type { IndicatorFamily, ObservationSurface } from './contract.js';
import { CONFIRMED_CLAIM_CODE } from './normalize.js';

export interface IngestEvent {
  observationId: string;
  surface: ObservationSurface;
  observedAt: string;
  synthetic: boolean;
  claimCodes: string[];
  indicators: Array<{ id: string; family: IndicatorFamily }>;
}

export interface TierInputs {
  crossSurfacePairs: Array<[ObservationSurface, ObservationSurface]>;
  families: IndicatorFamily[];
  hasConfirmedIndicator: boolean;
}

export interface Cluster {
  id: string;
  indicatorIds: string[];
  surfaces: ObservationSurface[];
  observationIds: string[];
  familyCount: number;
  claimCodes: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  perSurfaceCounts: Partial<Record<ObservationSurface, number>>;
  syntheticAll: boolean;
  tierInputs: TierInputs;
}

interface MutableCluster {
  id: string;
  indicatorIds: Set<string>;
  families: Set<IndicatorFamily>;
  observationIds: Set<string>;
  codes: Set<string>;
  surfaces: Set<ObservationSurface>;
  perSurfaceCounts: Map<ObservationSurface, number>;
  firstSeenAt: string;
  lastSeenAt: string;
  syntheticCount: number;
  observationCount: number;
  confirmed: boolean;
}

// Disjoint sets over indicator ids: two indicators share a root exactly when
// some chain of observations links them. Iterative find with path compression
// plus union by size; no library.
class UnionFind {
  private parent = new Map<string, string>();
  private size = new Map<string, number>();

  find(x: string): string {
    let root = x;
    let next = this.parent.get(root);
    while (next !== undefined && next !== root) {
      root = next;
      next = this.parent.get(root);
    }
    let node = x;
    let parent = this.parent.get(node);
    while (parent !== undefined && parent !== root) {
      this.parent.set(node, root);
      node = parent;
      parent = this.parent.get(node);
    }
    return root;
  }

  union(a: string, b: string): string {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return ra;
    const sizeA = this.size.get(ra) ?? 1;
    const sizeB = this.size.get(rb) ?? 1;
    if (sizeA < sizeB) {
      const tmp = ra;
      ra = rb;
      rb = tmp;
    }
    this.parent.set(rb, ra);
    this.size.set(ra, sizeA + sizeB);
    return ra;
  }
}

export function clusterIsEligibleForCard(cluster: Cluster): boolean {
  return cluster.surfaces.length >= 2 && cluster.observationIds.length >= 2;
}

function mergeInto(target: MutableCluster, donor: MutableCluster): void {
  for (const id of donor.indicatorIds) target.indicatorIds.add(id);
  for (const family of donor.families) target.families.add(family);
  for (const id of donor.observationIds) target.observationIds.add(id);
  for (const code of donor.codes) target.codes.add(code);
  for (const surface of donor.surfaces) target.surfaces.add(surface);
  for (const [surface, count] of donor.perSurfaceCounts) {
    target.perSurfaceCounts.set(surface, (target.perSurfaceCounts.get(surface) ?? 0) + count);
  }
  if (donor.firstSeenAt < target.firstSeenAt) target.firstSeenAt = donor.firstSeenAt;
  if (donor.lastSeenAt > target.lastSeenAt) target.lastSeenAt = donor.lastSeenAt;
  target.syntheticCount += donor.syntheticCount;
  target.observationCount += donor.observationCount;
  target.confirmed = target.confirmed || donor.confirmed;
}

function snapshot(m: MutableCluster): Cluster {
  const surfaces = [...m.surfaces].sort();
  const pairs: Array<[ObservationSurface, ObservationSurface]> = [];
  for (let i = 0; i < surfaces.length; i++) {
    for (let j = i + 1; j < surfaces.length; j++) {
      pairs.push([surfaces[i], surfaces[j]]);
    }
  }
  const perSurfaceCounts: Partial<Record<ObservationSurface, number>> = {};
  for (const [surface, count] of m.perSurfaceCounts) {
    perSurfaceCounts[surface] = count;
  }
  return {
    id: m.id,
    indicatorIds: [...m.indicatorIds].sort(),
    surfaces,
    observationIds: [...m.observationIds].sort(),
    familyCount: m.families.size,
    claimCodes: [...m.codes].sort(),
    firstSeenAt: m.firstSeenAt,
    lastSeenAt: m.lastSeenAt,
    perSurfaceCounts,
    syntheticAll: m.syntheticCount === m.observationCount,
    tierInputs: {
      crossSurfacePairs: pairs,
      families: [...m.families].sort(),
      hasConfirmedIndicator: m.confirmed
    }
  };
}

export class Correlator {
  private readonly uf = new UnionFind();
  private readonly byRoot = new Map<string, MutableCluster>();
  private readonly seen = new Set<string>();
  private seq = 0;

  ingest(event: IngestEvent): string[] {
    if (this.seen.has(event.observationId)) {
      const ids = new Set<string>();
      for (const ind of event.indicators) {
        const cluster = this.byRoot.get(this.uf.find(ind.id));
        if (cluster !== undefined) ids.add(cluster.id);
      }
      return [...ids].sort();
    }
    this.seen.add(event.observationId);
    // Narrative-only observations carry nothing correlatable: they join
    // no cluster rather than forming singletons.
    if (event.indicators.length === 0) return [];
    const roots = new Set<string>();
    for (const ind of event.indicators) roots.add(this.uf.find(ind.id));
    const merging = [...roots]
      .map((root) => this.byRoot.get(root))
      .filter((c): c is MutableCluster => c !== undefined)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const first = event.indicators[0].id;
    for (const ind of event.indicators) this.uf.union(first, ind.id);
    const root = this.uf.find(first);
    for (const r of roots) this.byRoot.delete(r);
    const survivor = merging[0] ?? this.freshCluster();
    for (const other of merging.slice(1)) mergeInto(survivor, other);
    for (const ind of event.indicators) {
      survivor.indicatorIds.add(ind.id);
      survivor.families.add(ind.family);
    }
    survivor.observationIds.add(event.observationId);
    survivor.surfaces.add(event.surface);
    survivor.perSurfaceCounts.set(event.surface, (survivor.perSurfaceCounts.get(event.surface) ?? 0) + 1);
    for (const code of event.claimCodes) survivor.codes.add(code);
    if (survivor.observationCount === 0) {
      survivor.firstSeenAt = event.observedAt;
      survivor.lastSeenAt = event.observedAt;
    } else {
      if (event.observedAt < survivor.firstSeenAt) survivor.firstSeenAt = event.observedAt;
      if (event.observedAt > survivor.lastSeenAt) survivor.lastSeenAt = event.observedAt;
    }
    if (event.synthetic) survivor.syntheticCount += 1;
    survivor.observationCount += 1;
    if (event.claimCodes.includes(CONFIRMED_CLAIM_CODE)) survivor.confirmed = true;
    this.byRoot.set(root, survivor);
    return [survivor.id];
  }

  clusters(): Cluster[] {
    return [...this.byRoot.values()].map(snapshot).sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  private freshCluster(): MutableCluster {
    this.seq += 1;
    return {
      id: `CLU-${String(this.seq).padStart(6, '0')}`,
      indicatorIds: new Set(),
      families: new Set(),
      observationIds: new Set(),
      codes: new Set(),
      surfaces: new Set(),
      perSurfaceCounts: new Map(),
      firstSeenAt: '',
      lastSeenAt: '',
      syntheticCount: 0,
      observationCount: 0,
      confirmed: false
    };
  }
}
