import React from 'react';
import type { ApiError, PipelineMetrics } from './api';
import { CheckIcon } from './icons';

export interface RestraintPanelProps {
  metrics: PipelineMetrics | null;
  loading: boolean;
  error: ApiError | null;
}

// "What stayed silent" renders the actual silence ledger — every row is a
// reason code with its count from /v1/metrics, never a generic reassurance.

export default function RestraintPanel(props: RestraintPanelProps): React.JSX.Element {
  const { metrics, loading, error } = props;
  const silent = metrics === null ? [] : Object.entries(metrics.silentByReason).sort((a, b) => b[1] - a[1]);
  const silentTotal = silent.reduce((sum, [, count]) => sum + count, 0);
  return (
    <section className="shield-panel" aria-label="What stayed silent">
      <h2>What stayed silent</h2>
      {error ? (
        <p className="shield-error" role="alert">
          {error.code}
        </p>
      ) : null}
      {loading && metrics === null ? <p className="shield-muted">Loading metrics…</p> : null}
      {metrics ? (
        <>
          <p data-testid="restraint-counts" aria-live="polite" className="shield-counts">
            {metrics.eligibleEvents} eligible · {metrics.cards} emitted
          </p>
          <p data-testid="restraint-silent-line">No card emitted for {silentTotal} eligible events</p>
          {silent.length === 0 ? (
            <p className="shield-muted">Nothing silent yet.</p>
          ) : (
            <ul className="shield-silent-list">
              {silent.map(([reason, count]) => (
                <li key={reason} className="shield-silent-row">
                  <span className="shield-check" aria-hidden="true">
                    <CheckIcon size={16} />
                  </span>
                  <span className="shield-mono">{reason}</span>
                  <span className="shield-muted">
                    {count} event{count === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="shield-muted">
            {metrics.demotions} demotion{metrics.demotions === 1 ? '' : 's'} · {metrics.modelCalls} model calls · $
            {metrics.costEstimateUsd.toFixed(4)} estimated
          </p>
        </>
      ) : null}
    </section>
  );
}
