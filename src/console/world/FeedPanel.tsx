import React from 'react';
import type { WorldEventDTO, IntegrityDTO } from './api';
import { SURFACE_META, eventLabel, fmtClock, fmtCount } from './format';
import { FeedIcon, InfoIcon, ShieldCheckIcon, WarnIcon } from './icons';

interface Props {
  events: WorldEventDTO[];
  handleOf: (accountId: string) => string | null;
  operatorView: boolean;
  onToggleOperator: () => void;
  integrity: IntegrityDTO | null;
  scamIds: Set<string> | null;
  totalEvents: number;
  onViewAll: () => void;
}

export default function FeedPanel(props: Props): React.JSX.Element {
  const [integrityOpen, setIntegrityOpen] = React.useState(false);
  const seenRef = React.useRef<Set<string> | null>(null);
  if (seenRef.current === null) {
    seenRef.current = new Set(props.events.map((e) => e.id));
  }
  const seen = seenRef.current;
  React.useEffect(() => {
    for (const e of props.events) seen.add(e.id);
  }, [props.events, seen]);

  // Pulse only when a few rows are new: at high sim rates every poll brings
  // a full page of new rows, and pulsing all of them would strobe the panel.
  const freshIds = new Set(props.events.filter((e) => !seen.has(e.id)).map((e) => e.id));
  const pulseOn = freshIds.size > 0 && freshIds.size <= 12;

  const warnings = props.events.filter((e) => e.type === 'warning_shown');
  const flagged = props.events.filter((e) => e.indicators.length > 0).length;
  const leaks = props.integrity?.canaryLeaks ?? 0;

  return (
    <section className="panel panel-feed" aria-label="Live feed">
      <div className="panel-head">
        <span className="head-icon" aria-hidden="true">
          <FeedIcon size={16} />
        </span>
        <h2>Live feed</h2>
        <span className="count">{fmtCount(props.events.length)} events</span>
        <div className="head-right">
          <label className="toggle">
            <input type="checkbox" checked={props.operatorView} onChange={props.onToggleOperator} />
            <span>Operator view</span>
          </label>
          <button
            type="button"
            className={integrityOpen ? 'btn btn-sm on' : 'btn btn-sm'}
            aria-pressed={integrityOpen}
            onClick={() => setIntegrityOpen((v) => !v)}
          >
            <ShieldCheckIcon size={14} />
            <span>Integrity</span>
          </button>
        </div>
      </div>

      <div className={integrityOpen ? 'feed-body with-integrity' : 'feed-body'}>
        <div className="feed-col">
          <div className="thead feed-grid">
            <span>Time</span>
            <span>Surface</span>
            <span>Type</span>
            <span>Actor → Target</span>
            <span aria-hidden="true" />
          </div>
          <ol className="feed-list">
            {props.events.map((e) => {
              const fresh = pulseOn && freshIds.has(e.id);
              const scam = props.operatorView && (props.scamIds?.has(e.id) ?? false);
              const warn = e.indicators.length > 0;
              const from = props.handleOf(e.actorId) ?? e.actorId;
              const to = e.targetId ? (props.handleOf(e.targetId) ?? e.targetId) : null;
              return (
                <li key={e.id} className={fresh ? 'feed-row feed-grid is-new' : 'feed-row feed-grid'}>
                  <span className="f-time">{fmtClock(e.simMinute)}</span>
                  <span>
                    <span className={`chip ${SURFACE_META[e.surface].cls}`}>{SURFACE_META[e.surface].label}</span>
                  </span>
                  <span className="f-type">{eventLabel(e.type)}</span>
                  <span className="f-actors" title={`@${from}${to ? ` → @${to}` : ''}`}>
                    @{from}
                    {to ? <span className="f-arrow"> → </span> : null}
                    {to ? `@${to}` : null}
                  </span>
                  <span className="f-flag">
                    {scam ? (
                      <span className="badge b-red">SCAM</span>
                    ) : warn ? (
                      <span className="flag warn" title="Indicators present">
                        <WarnIcon size={13} />
                      </span>
                    ) : (
                      <span className="flag info" title="Standard event">
                        <InfoIcon size={13} />
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          <footer className="panel-foot feed-foot">
            <span>
              Latest {fmtCount(props.events.length)} of {fmtCount(props.totalEvents)} events
            </span>
            <button type="button" className="link-btn" onClick={props.onViewAll}>
              View all events →
            </button>
          </footer>
        </div>

        {integrityOpen ? (
          <aside className="integrity-panel" aria-label="Integrity panel">
            <div className="integrity-head">
              <h3>Integrity Panel</h3>
            </div>
            <ul className="integrity-stats">
              <li>
                <span className="dot amber" aria-hidden="true" />
                <strong>{fmtCount(warnings.length)}</strong> warnings
              </li>
              <li>
                <span className="dot blue" aria-hidden="true" />
                <strong>{fmtCount(flagged)}</strong> flagged events
              </li>
              <li>
                <span className={leaks === 0 ? 'dot green' : 'dot red'} aria-hidden="true" />
                <strong>{fmtCount(leaks)}</strong> canary leaks
              </li>
            </ul>
            <h4>Recent warnings</h4>
            {warnings.length === 0 ? (
              <p className="empty small">No warnings in the current buffer.</p>
            ) : (
              <ul className="warning-list">
                {warnings.slice(0, 5).map((w) => (
                  <li key={w.id}>
                    <span className="warning-flag" aria-hidden="true">
                      <WarnIcon size={12} />
                    </span>
                    <span>
                      <span className="warning-text">{w.payload?.reason ?? eventLabel(w.type)}</span>
                      <span className="warning-time">
                        {fmtClock(w.simMinute)} · {SURFACE_META[w.surface].label}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
