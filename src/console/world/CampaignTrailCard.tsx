import React from 'react';
import type { CampaignDTO } from './api';
import { SURFACE_META, fmtAmount, fmtClock, fmtTick, outcomeBadge, stageName, templateName } from './format';

interface Props {
  campaigns: CampaignDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  handleOf: (accountId: string) => string | null;
}

const STAGES = ['publish', 'exposure', 'contact', 'lure', 'request', 'cashout'];

export default function CampaignTrailCard(props: Props): React.JSX.Element {
  const selected = props.campaigns.find((c) => c.id === props.selectedId) ?? props.campaigns[0] ?? null;

  if (!selected) {
    return <p className="empty">No campaigns in this world yet.</p>;
  }

  const badge = outcomeBadge(selected.outcome);
  const nextStage = STAGES[STAGES.indexOf(selected.stage) + 1] ?? null;
  const currentSurface = selected.trail[selected.trail.length - 1]?.surface ?? selected.path[0] ?? 'facebook';

  return (
    <div className="trail-card">
      <div className="ct-tabs" role="tablist" aria-label="Campaigns">
        {props.campaigns.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === selected.id}
            className={c.id === selected.id ? 'ct-tab on' : 'ct-tab'}
            onClick={() => props.onSelect(c.id)}
          >
            {c.id}
          </button>
        ))}
      </div>

      <div className="ct-title">
        <span className={`chip chip-sq ${SURFACE_META[currentSurface].cls}`} aria-hidden="true">
          {SURFACE_META[currentSurface].short}
        </span>
        <strong>{templateName(selected.templateKey)}</strong>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
      </div>

      <dl className="ct-meta">
        <div>
          <dt>Target</dt>
          <dd>{selected.targetHandle ? `@${selected.targetHandle}` : selected.targetPersonId}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{fmtAmount(selected.amount)}</dd>
        </div>
      </dl>

      <div className="ct-chips" aria-label={`Stage trail: ${selected.path.join(' → ')}`}>
        {selected.path.map((s, i) => (
          <React.Fragment key={`${s}-${i}`}>
            {i > 0 ? (
              <span className="trail-arrow" aria-hidden="true">
                →
              </span>
            ) : null}
            <span className={`chip ${SURFACE_META[s].cls}${s === currentSurface ? ' current' : ''}`}>
              {SURFACE_META[s].label}
            </span>
          </React.Fragment>
        ))}
      </div>

      <h4>Details</h4>
      <dl className="kv kv-wide">
        <div>
          <dt>Start</dt>
          <dd>{fmtTick(selected.startedAt)}</dd>
        </div>
        <div>
          <dt>Current stage</dt>
          <dd>
            <span className="muted">{stageName(selected.stage)}</span> ·{' '}
            <span className={`chip chip-sq ${SURFACE_META[currentSurface].cls}`}>
              {SURFACE_META[currentSurface].short}
            </span>
          </dd>
        </div>
        <div>
          <dt>Next stage</dt>
          <dd>{nextStage ? stageName(nextStage) : 'None — resolved'}</dd>
        </div>
        <div>
          <dt>Target handle</dt>
          <dd>{selected.targetHandle ? `@${selected.targetHandle}` : selected.targetPersonId}</dd>
        </div>
        <div>
          <dt>Spend</dt>
          <dd>{fmtAmount(selected.amount)}</dd>
        </div>
        <div>
          <dt>Outcome</dt>
          <dd>
            <span className={`badge ${badge.cls}`}>{badge.label}</span>
          </dd>
        </div>
      </dl>

      <h4>Stage trail</h4>
      <ol className="stage-list">
        {selected.trail.map((t, i) => {
          const hop = i > 0 && selected.trail[i - 1].surface !== t.surface;
          return (
            <li key={`${t.stage}-${t.atMinute}`} className={hop ? 'stage hop' : 'stage'}>
              <span className="stage-time">{fmtClock(t.atMinute)}</span>
              <span className={`chip chip-sq ${SURFACE_META[t.surface].cls}`}>{SURFACE_META[t.surface].short}</span>
              <span className="stage-label">{stageName(t.stage)}</span>
              <span className="stage-actor">
                {props.handleOf(t.actorId) ? `@${props.handleOf(t.actorId)}` : t.actorId}
              </span>
              {hop ? <span className="hop-tag">hop</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
