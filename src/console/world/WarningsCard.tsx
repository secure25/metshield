import React from 'react';
import type { WorldEventDTO, IntegrityDTO } from './api';
import { SURFACE_META, eventLabel, fmtClock, fmtCount } from './format';
import { InfoIcon, WarnIcon } from './icons';

interface Props {
  events: WorldEventDTO[];
  handleOf: (accountId: string) => string | null;
  operatorView: boolean;
  onToggleOperator: () => void;
  integrity: IntegrityDTO | null;
  scamIds: Set<string> | null;
}

const ROWS = 8;

export default function WarningsCard(props: Props): React.JSX.Element {
  // The feed runs at up to 60 simulated minutes per second, so a clicked event
  // leaves the buffer within a poll or two. The detail panel holds on to the
  // event itself instead of looking it up again by id.
  const [selected, setSelected] = React.useState<WorldEventDTO | null>(null);

  const flagged = props.events.filter((e) => e.indicators.length > 0);
  const rows = props.events.slice(0, ROWS);
  const selectedId = selected?.id ?? null;
  const leaks = props.integrity?.canaryLeaks ?? 0;

  return (
    <div className="warn-card">
      <div className="warn-toolbar">
        <label className="toggle">
          <input type="checkbox" checked={props.operatorView} onChange={props.onToggleOperator} />
          <span>Operator view</span>
        </label>
        <span className="warn-count">{fmtCount(flagged.length)} flagged in buffer</span>
      </div>

      <div className="warn-body">
        <div className="warn-feed">
          <div className="thead warn-grid">
            <span>Time</span>
            <span>Surface</span>
            <span>Type</span>
            <span>Actor → Target</span>
            <span aria-hidden="true" />
          </div>
          <ol className="warn-list">
            {rows.map((e) => {
              const warn = e.indicators.length > 0;
              const scam = props.operatorView && (props.scamIds?.has(e.id) ?? false);
              const from = props.handleOf(e.actorId) ?? e.actorId;
              const to = e.targetId ? (props.handleOf(e.targetId) ?? e.targetId) : null;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    className={e.id === selectedId ? 'warn-row warn-grid on' : 'warn-row warn-grid'}
                    onClick={() => setSelected(e.id === selectedId ? null : e)}
                    aria-pressed={e.id === selectedId}
                  >
                    <span className="f-time">{fmtClock(e.simMinute)}</span>
                    <span>
                      <span className={`chip ${SURFACE_META[e.surface].cls}`}>{SURFACE_META[e.surface].label}</span>
                    </span>
                    <span className="f-type">{eventLabel(e.type)}</span>
                    <span className="f-actors">
                      @{from}
                      {to ? <span className="f-arrow"> → </span> : null}
                      {to ? `@${to}` : null}
                    </span>
                    <span className="f-flag">
                      {scam ? (
                        <span className="badge b-red">SCAM</span>
                      ) : warn ? (
                        <span className="flag warn" title="Indicators present">
                          <WarnIcon size={12} />
                        </span>
                      ) : (
                        <span className="flag info" title="Standard event">
                          <InfoIcon size={12} />
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <aside className="warn-aside">
          <h4>Integrity Panel</h4>
          <ul className="integrity-stats">
            <li>
              <span className="dot amber" aria-hidden="true" />
              <strong>{fmtCount(flagged.length)}</strong> warnings
            </li>
            <li>
              <span className="dot blue" aria-hidden="true" />
              <strong>{fmtCount(new Set(props.events.map((e) => e.surface)).size)}</strong> surfaces active
            </li>
            <li>
              <span className={leaks === 0 ? 'dot green' : 'dot red'} aria-hidden="true" />
              <strong>{fmtCount(leaks)}</strong> canary leaks
            </li>
          </ul>
          <h4>Recent warnings</h4>
          {flagged.length === 0 ? (
            <p className="empty small">No warnings in the current buffer.</p>
          ) : (
            <ul className="warning-list">
              {flagged.slice(0, 4).map((w) => (
                <li key={w.id}>
                  <span className="warning-flag" aria-hidden="true">
                    <WarnIcon size={11} />
                  </span>
                  <span>
                    <span className="warning-text">{w.indicators.map((i) => i.kind.replace(/_/g, ' ')).join(', ')}</span>
                    <span className="warning-time">
                      {fmtClock(w.simMinute)} · {SURFACE_META[w.surface].label}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <div className="event-detail">
        {selected ? (
          <>
            <div className="ed-head">
              <strong>{eventLabel(selected.type)}</strong>
              <span className="muted">
                {selected.id} · {fmtClock(selected.simMinute)} · {SURFACE_META[selected.surface].label}
                {props.events.some((e) => e.id === selected.id) ? '' : ' · left buffer'}
              </span>
            </div>
            <div className="ed-row">
              <span className="muted">Actor → target</span>
              <span className="mono">
                @{props.handleOf(selected.actorId) ?? selected.actorId}
                {selected.targetId ? ` → @${props.handleOf(selected.targetId) ?? selected.targetId}` : ' → —'}
              </span>
            </div>
            <div className="ed-row">
              <span className="muted">Indicators</span>
              <span className="mono">
                {selected.indicators.length === 0
                  ? 'none'
                  : selected.indicators.map((i) => `${i.kind}=${i.value}`).join(' · ')}
              </span>
            </div>
          </>
        ) : (
          <p className="ed-hint">Click a row to see the full event details. Truth tag is hidden by default.</p>
        )}
      </div>
    </div>
  );
}
