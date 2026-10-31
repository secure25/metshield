import React from 'react';
import type { ApiError, Card, Proposal } from './api';
import { FAMILY_LABELS, toSurfacePayload } from '../../emit.js';
import { formatAge, formatDateTime, formatSpan } from './format';

export interface EvidencePanelProps {
  cards: Card[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  card: Card | null;
  proposal: Proposal | null;
  error: ApiError | null;
  loading: boolean;
  nowMs: number;
}

function tierLine(card: Card, proposal: Proposal | null): string {
  if (proposal?.tier === undefined || proposal.tier === null) return `Tier ${card.tier} · proposal unavailable`;
  if (proposal.tier === card.tier) return `Tier ${card.tier} (as proposed)`;
  return `Proposed ${proposal.tier} · final ${card.tier}`;
}

export default function EvidencePanel(props: EvidencePanelProps): React.JSX.Element {
  const { cards, selectedId, onSelect, card, proposal, error, loading, nowMs } = props;
  const privacyLine = card === null ? null : toSurfacePayload(card, nowMs).privacyLine;
  const observed = card === null ? [] : [...card.citations].map((citation) => citation.observedAt).sort();
  const span = observed.length >= 2 ? formatSpan(observed[0] as string, observed[observed.length - 1] as string) : null;
  return (
    <section className="shield-panel" aria-label="Evidence">
      <h2>Evidence</h2>
      {cards.length === 0 && !loading ? <p className="shield-muted">No cards emitted yet.</p> : null}
      <ul className="shield-card-list">
        {cards.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={entry.id === selectedId ? 'shield-card shield-card-selected' : 'shield-card'}
              aria-pressed={entry.id === selectedId}
              onClick={() => onSelect(entry.id)}
            >
              <span className="shield-card-id">{entry.id}</span>
              <span className={`shield-tier shield-tier-${entry.tier}`}>{entry.tier}</span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="shield-error" role="alert">
          {error.code}
        </p>
      ) : null}
      {loading && card === null && !error ? <p className="shield-muted">Loading card…</p> : null}
      {card && !error ? (
        <article className="shield-evidence">
          <h3>{card.headline}</h3>
          <p className="shield-tier-line">{tierLine(card, proposal)}</p>
          <p>{card.body}</p>
          <p className="shield-privacy">{privacyLine}</p>
          {card.provenance.attribution ? (
            <p className="shield-muted">
              Listed by {card.provenance.attribution.feedName} · {formatDateTime(card.provenance.attribution.publishedAt)}
            </p>
          ) : null}
          <h4>Cited indicators</h4>
          <ul className="shield-cite-list">
            {card.citations.map((citation, index) => (
              <li
                key={`${citation.observationId}:${citation.indicatorId}:${index}`}
                data-testid="citation-chip"
                className="shield-cite"
              >
                <span className="shield-cite-display">{citation.display}</span>
                <span className="shield-muted">{FAMILY_LABELS[citation.family]}</span>
                <span className="shield-chip">{citation.surface}</span>
                <span className="shield-muted">
                  {formatDateTime(citation.observedAt)} · {formatAge(nowMs, citation.observedAt)}
                </span>
              </li>
            ))}
          </ul>
          {span ? (
            <p className="shield-muted" data-testid="citation-span">
              Cited observations {span}
            </p>
          ) : (
            <p className="shield-muted">Single cited observation</p>
          )}
          <h4>Dropped claims</h4>
          {card.provenance.dropped.length === 0 ? (
            <p className="shield-muted">None — every claim survived validation.</p>
          ) : (
            <ul className="shield-drop-list">
              {card.provenance.dropped.map((dropped, index) => (
                <li key={`${dropped.rule}:${index}`} className="shield-drop">
                  <span className="shield-rule">{dropped.rule}</span>
                  <span>{dropped.text}</span>
                  <span className="shield-muted">{dropped.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      ) : null}
    </section>
  );
}
