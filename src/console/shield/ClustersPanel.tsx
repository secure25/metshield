import React from 'react';
import type { ApiError, Card, Cluster } from './api';
import { formatSpan } from './format';

export interface ClustersPanelProps {
  clusters: Cluster[];
  cards: Card[];
  selectedClusterId: string | null;
  onSelectCluster: (clusterId: string) => void;
  loading: boolean;
  error: ApiError | null;
}

// Three states, not two: "mixed sources" is a claim about the data, so it is
// only made when more than one surface actually contributed. A single-surface
// cluster says so instead of inheriting the mixed label by default.
function sourceLabel(cluster: Cluster): string {
  if (cluster.syntheticAll) return 'synthetic';
  return cluster.surfaces.length > 1 ? 'mixed sources' : 'single source';
}

function surfaceCounts(cluster: Cluster): string {
  const entries = Object.entries(cluster.perSurfaceCounts);
  if (entries.length === 0) return 'no observations';
  return entries
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([surface, count]) => `${surface} ${count ?? 0}`)
    .join(' · ');
}

const TIER_RANK: Record<Card['tier'], number> = { context: 0, corroborated: 1, confirmed: 2 };

// The badge names the highest card tier emitted from this cluster — a real
// escalation ladder, not an invented severity scale. A cluster with no card
// says so rather than borrowing a neighbor's tier.
function clusterBadge(cluster: Cluster, cards: Card[]): Card['tier'] | null {
  let best: Card['tier'] | null = null;
  for (const card of cards) {
    if (card.clusterId !== cluster.id) continue;
    if (best === null || TIER_RANK[card.tier] > TIER_RANK[best]) best = card.tier;
  }
  return best;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export default function ClustersPanel(props: ClustersPanelProps): React.JSX.Element {
  const { clusters, cards, selectedClusterId, onSelectCluster, loading, error } = props;
  return (
    <section id="shield-operations" className="shield-panel" aria-label="Open operations">
      <h2>Open operations</h2>
      {error ? (
        <p className="shield-error" role="alert">
          {error.code}
        </p>
      ) : null}
      {loading && clusters.length === 0 ? <p className="shield-muted">Loading clusters…</p> : null}
      {!loading && !error && clusters.length === 0 ? <p className="shield-muted">No clusters yet.</p> : null}
      <ul className="shield-cluster-list">
        {clusters.map((cluster) => {
          const selected = cluster.id === selectedClusterId;
          const badge = clusterBadge(cluster, cards);
          return (
            <li key={cluster.id}>
              <button
                type="button"
                className={selected ? 'shield-cluster shield-cluster-selected' : 'shield-cluster'}
                aria-pressed={selected}
                onClick={() => onSelectCluster(cluster.id)}
              >
                <span className="shield-cluster-head">
                  <span className="shield-cluster-id">{cluster.id}</span>
                  {badge === null ? (
                    <span className="shield-tier shield-tier-none">no card</span>
                  ) : (
                    <span className={`shield-tier shield-tier-${badge}`}>{badge}</span>
                  )}
                </span>
                <span className="shield-muted">
                  {plural(cluster.indicatorIds.length, 'indicator', 'indicators')} ·{' '}
                  {plural(cluster.observationIds.length, 'observation', 'observations')}
                </span>
                <span className="shield-muted">{surfaceCounts(cluster)}</span>
                <span className="shield-muted">{formatSpan(cluster.firstSeenAt, cluster.lastSeenAt)}</span>
                <span className="shield-chip-row">
                  {cluster.surfaces.map((surface) => (
                    <span key={surface} className="shield-chip">
                      {surface}
                    </span>
                  ))}
                  <span className={cluster.syntheticAll ? 'shield-chip shield-chip-synthetic' : 'shield-chip'}>
                    {sourceLabel(cluster)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
