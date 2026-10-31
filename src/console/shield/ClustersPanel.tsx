import React from 'react';
import type { ApiError, Cluster } from './api';
import { formatSpan } from './format';

export interface ClustersPanelProps {
  clusters: Cluster[];
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

export default function ClustersPanel(props: ClustersPanelProps): React.JSX.Element {
  const { clusters, selectedClusterId, onSelectCluster, loading, error } = props;
  return (
    <section className="shield-panel" aria-label="Clusters">
      <h2>Clusters</h2>
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
          return (
            <li key={cluster.id}>
              <button
                type="button"
                className={selected ? 'shield-cluster shield-cluster-selected' : 'shield-cluster'}
                aria-pressed={selected}
                onClick={() => onSelectCluster(cluster.id)}
              >
                <span className="shield-cluster-id">{cluster.id}</span>
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
                <span className="shield-muted">
                  {cluster.indicatorIds.length} indicators · {cluster.observationIds.length} observations
                </span>
                <span className="shield-muted">{surfaceCounts(cluster)}</span>
                <span className="shield-muted">{formatSpan(cluster.firstSeenAt, cluster.lastSeenAt)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
