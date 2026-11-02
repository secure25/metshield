import React from 'react';
import type { ApiError, Card } from './api';
import { toSurfacePayload } from '../../emit.js';
import { formatDateTime } from './format';

// Presentation copy for the safe-action enum. Console-local: the validator
// checks membership, never this text, and card bodies never carry it.
const SAFE_ACTION_LABELS: Record<Card['safeAction'], string> = {
  do_not_pay: "Don't pay or send money through this link.",
  do_not_share_code: "Don't share the code sent to your phone.",
  leave_and_report: 'Leave this conversation and report it.',
  verify_in_app: 'Verify through the official app, not this chat.'
};

export interface SurfacePreviewProps {
  card: Card | null;
  error: ApiError | null;
  loading: boolean;
  nowMs: number;
}

export default function SurfacePreview(props: SurfacePreviewProps): React.JSX.Element {
  const { card, error, loading, nowMs } = props;
  const [dismissed, setDismissed] = React.useState(false);
  React.useEffect(() => {
    setDismissed(false);
  }, [card?.id]);
  const payload = card === null ? null : toSurfacePayload(card, nowMs);
  return (
    <section className="shield-panel" aria-label="Surface preview" data-testid="surface-preview">
      <h2>User-facing preview</h2>
      <p className="shield-muted">Example rendering — host product controls final wording.</p>
      <p className="shield-caption">Preview of the payload a product renders under its own warning.</p>
      {error ? (
        <p className="shield-error" role="alert">
          {error.code}
        </p>
      ) : null}
      {loading && card === null && !error ? <p className="shield-muted">Loading card…</p> : null}
      {!loading && card === null && !error ? <p className="shield-muted">Select a card to preview it.</p> : null}
      {card && payload && !error ? (
        <div className="shield-preview">
          <div className="shield-existing-warning">An existing warning is already here</div>
          {dismissed ? (
            <p className="shield-muted">Preview dismissed.</p>
          ) : (
            <article className="shield-payload">
              <p>
                <span className={`shield-severity shield-severity-${payload.severity}`}>{payload.severity}</span>{' '}
                <span className={`shield-tier shield-tier-${payload.tier}`}>{payload.tier}</span>
              </p>
              <h3>{payload.headline}</h3>
              <p>{payload.body}</p>
              <p className="shield-safe-action">{SAFE_ACTION_LABELS[payload.safeAction]}</p>
              <p className="shield-privacy">{payload.privacyLine}</p>
              {payload.attribution ? (
                <p className="shield-muted">
                  Listed by {payload.attribution.feedName} · {formatDateTime(payload.attribution.publishedAt)}
                </p>
              ) : null}
              <ul className="shield-cite-list">
                {payload.citations.map((citation, index) => (
                  <li
                    key={`${citation.surface}:${citation.display}:${index}`}
                    data-testid="preview-chip"
                    className="shield-cite"
                  >
                    <span className="shield-chip">{citation.surface}</span>
                    <span className="shield-cite-display">{citation.display}</span>
                    <span className="shield-muted">
                      {citation.ageMinutes < 1 ? 'just now' : `${citation.ageMinutes}m ago`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="shield-muted">Expires {formatDateTime(payload.expiresAt)}</p>
              {payload.dismissible ? (
                <button type="button" className="shield-button" onClick={() => setDismissed(true)}>
                  Dismiss
                </button>
              ) : (
                <button type="button" className="shield-button" disabled title="Not dismissible at this tier">
                  Cannot dismiss
                </button>
              )}
            </article>
          )}
        </div>
      ) : null}
    </section>
  );
}
