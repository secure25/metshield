import React from 'react';
import type { CampaignDTO, Surface } from './api';
import { SURFACE_META, fmtAmount, outcomeBadge, templateName } from './format';
import { CampaignIcon } from './icons';

interface Props {
  campaigns: CampaignDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// One chip per surface the journey touches, in order: the full six-stage trail
// is too wide for a row, and the hops between surfaces are what the row is for.
function surfaceRun(c: CampaignDTO): Surface[] {
  const out: Surface[] = [];
  for (const t of c.trail) {
    if (out.length === 0 || out[out.length - 1] !== t.surface) out.push(t.surface);
  }
  return out;
}

export default function CampaignsPanel(props: Props): React.JSX.Element {
  const active = props.campaigns.filter((c) => c.outcome == null).length;

  return (
    <section className="panel panel-campaigns" aria-label="Campaigns">
      <div className="panel-head">
        <span className="head-icon" aria-hidden="true">
          <CampaignIcon size={16} />
        </span>
        <h2>Campaigns</h2>
        <span className="count">
          Active journeys <span className="pill">{active}</span>
        </span>
      </div>

      <div className="thead camp-grid">
        <span>Journey</span>
        <span>Target</span>
        <span className="ta-r">Amount</span>
        <span className="ta-r">Outcome</span>
      </div>

      <div className="panel-body">
        {props.campaigns.length === 0 ? (
          <p className="empty">No campaigns in this world yet. Press Step to advance the clock.</p>
        ) : (
          <ul className="camp-list">
            {props.campaigns.map((c) => {
              const surfaces = surfaceRun(c);
              const badge = outcomeBadge(c.outcome);
              const selected = props.selectedId === c.id;
              return (
                <li key={c.id} className="camp">
                  <button
                    type="button"
                    className={selected ? 'camp-row camp-grid on' : 'camp-row camp-grid'}
                    onClick={() => props.onSelect(c.id)}
                    aria-pressed={selected}
                  >
                    <span className="camp-main">
                      <span className="camp-name">{templateName(c.templateKey)}</span>
                      <span className="camp-trail" aria-label={`Surfaces: ${surfaces.join(' → ')}`}>
                        {surfaces.length === 0 ? <span className="muted">scheduled</span> : null}
                        {surfaces.map((s, i) => (
                          <React.Fragment key={`${s}-${i}`}>
                            {i > 0 ? (
                              <span className="trail-arrow" aria-hidden="true">
                                →
                              </span>
                            ) : null}
                            <span
                              className={`chip chip-sq ${SURFACE_META[s].cls}${i === surfaces.length - 1 ? ' current' : ''}`}
                            >
                              {SURFACE_META[s].short}
                            </span>
                          </React.Fragment>
                        ))}
                      </span>
                    </span>
                    <span className="camp-target">{c.targetHandle ? `@${c.targetHandle}` : c.targetPersonId}</span>
                    <span className="camp-amount">{fmtAmount(c.amount)}</span>
                    <span className="camp-outcome">
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="panel-foot">
        <span>
          {props.campaigns.length} {props.campaigns.length === 1 ? 'journey' : 'journeys'} in this world
        </span>
        <span>Select a journey for its trail</span>
      </footer>
    </section>
  );
}
