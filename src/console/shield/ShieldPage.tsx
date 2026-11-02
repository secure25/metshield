import React from 'react';
import '../shield.css';
import type { ApiError, Card, Cluster, PipelineMetrics } from './api';
import type { CardDetailResponse } from './api';
import { ApiError as ApiErrorValue, fetchCardDetail, fetchCardsPage, fetchClusters, fetchHealth, fetchMetrics } from './api';
import Sidebar from './Sidebar';
import StatsRow from './StatsRow';
import ClustersPanel from './ClustersPanel';
import EvidencePanel from './EvidencePanel';
import RestraintPanel from './RestraintPanel';
import SurfacePreview from './SurfacePreview';

export interface ShieldPageProps {
  /** Live refresh interval; 0 disables polling (tests, screenshots). */
  pollMs?: number;
  /** Frozen clock for deterministic ages; defaults to Date.now() at render. */
  nowMs?: number;
}

function toApiError(reason: unknown): ApiError {
  return reason instanceof ApiErrorValue ? reason : new ApiErrorValue('network_error', 0);
}

export default function ShieldPage({ pollMs = 5000, nowMs }: ShieldPageProps): React.JSX.Element {
  const now = nowMs ?? Date.now();
  const [clusters, setClusters] = React.useState<Cluster[]>([]);
  const [cards, setCards] = React.useState<Card[]>([]);
  const [metrics, setMetrics] = React.useState<PipelineMetrics | null>(null);
  const [version, setVersion] = React.useState<string | null>(null);
  const [clustersError, setClustersError] = React.useState<ApiError | null>(null);
  const [cardsError, setCardsError] = React.useState<ApiError | null>(null);
  const [metricsError, setMetricsError] = React.useState<ApiError | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<CardDetailResponse | null>(null);
  const [detailError, setDetailError] = React.useState<ApiError | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const loadAll = React.useCallback(async () => {
    const settled = await Promise.allSettled([fetchClusters(), fetchCardsPage(), fetchMetrics(), fetchHealth()]);
    const [clustersRes, cardsRes, metricsRes, healthRes] = settled;
    if (clustersRes.status === 'fulfilled') {
      setClusters(clustersRes.value);
      setClustersError(null);
    } else {
      setClustersError(toApiError(clustersRes.reason));
    }
    if (cardsRes.status === 'fulfilled') {
      setCards(cardsRes.value.cards);
      setCardsError(null);
      setSelectedId((prev) => {
        if (prev !== null) return prev;
        const first = cardsRes.value.cards[0];
        return first === undefined ? null : first.id;
      });
    } else {
      setCardsError(toApiError(cardsRes.reason));
    }
    if (metricsRes.status === 'fulfilled') {
      setMetrics(metricsRes.value);
      setMetricsError(null);
    } else {
      setMetricsError(toApiError(metricsRes.reason));
    }
    if (healthRes.status === 'fulfilled') {
      setVersion(healthRes.value.version);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void loadAll();
    if (pollMs <= 0) return undefined;
    const timer = setInterval(() => {
      void loadAll();
    }, pollMs);
    return () => clearInterval(timer);
  }, [loadAll, pollMs]);

  React.useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetchCardDetail(selectedId).then(
      (response) => {
        if (cancelled) return;
        setDetail(response);
        setDetailError(null);
        setDetailLoading(false);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(toApiError(reason));
        setDetailLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshKey]);

  const selectedClusterId = cards.find((card) => card.id === selectedId)?.clusterId ?? null;

  const handleSelectCluster = (clusterId: string): void => {
    const match = cards.find((card) => card.clusterId === clusterId);
    if (match !== undefined) setSelectedId(match.id);
  };

  const handleRefresh = (): void => {
    setRefreshKey((key) => key + 1);
    void loadAll();
  };

  return (
    <div className="shield-shell">
      <Sidebar />
      <main className="shield-page">
        <header className="shield-header">
          <div>
            <h1>
              Signal review <span className="shield-data-badge">Synthetic / public data</span>
            </h1>
            <p className="shield-muted">
              Investigate signals, review evidence, and apply <strong>restraint</strong>. Not affiliated with any Meta product.
            </p>
          </div>
          <div className="shield-header-controls">
            <button type="button" className="shield-button" onClick={handleRefresh}>
              Refresh
            </button>
          </div>
        </header>
        <StatsRow clusters={clusters} cards={cards} metrics={metrics} />
        <div className="shield-grid">
          <ClustersPanel
            clusters={clusters}
            cards={cards}
            selectedClusterId={selectedClusterId}
            onSelectCluster={handleSelectCluster}
            loading={loading}
            error={clustersError}
          />
          <EvidencePanel
            cards={cards}
            selectedId={selectedId}
            onSelect={setSelectedId}
            card={detail?.card ?? null}
            proposal={detail?.proposal ?? null}
            error={detailError ?? cardsError}
            loading={loading || detailLoading}
            nowMs={now}
          />
          <div id="shield-restraint" className="shield-third-column">
            <RestraintPanel metrics={metrics} loading={loading} error={metricsError} />
            <SurfacePreview card={detail?.card ?? null} error={detailError} loading={loading || detailLoading} nowMs={now} />
          </div>
        </div>
        <footer className="shield-footer">
          <span className="shield-muted">Evidence first · Least-claim warning · Synthetic environment.</span>
          <span className="shield-muted">
            MetShield v{version ?? 'unknown'} · Synthetic and public data · Not affiliated with any Meta product.
          </span>
        </footer>
      </main>
    </div>
  );
}
