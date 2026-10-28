import React from 'react';
import { fmtSimTime, dayOf } from './format';
import { ClockIcon, PauseIcon, ResetIcon, ShieldIcon, StepIcon } from './icons';

interface Props {
  tick: number;
  simulatedAt: string;
  scale: number;
  onScale: (scale: number) => void;
  paused: boolean;
  onPause: () => void;
  onStep: () => void;
  seedInput: string;
  onSeedInput: (value: string) => void;
  onReset: () => void;
}

const SCALES = [1, 10, 60, 240];

export default function ClockStrip(props: Props): React.JSX.Element {
  return (
    <header className="strip">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <ShieldIcon size={24} />
        </span>
        <span className="brand-text">
          <strong>MetShield</strong>
          <small>Operator Console — Simulated World</small>
        </span>
      </div>

      <div className="hgroup hgroup-clock" title={props.simulatedAt}>
        <span className="hgroup-icon" aria-hidden="true">
          <ClockIcon size={16} />
        </span>
        <span className="hgroup-stack">
          <span className="hlabel">Simulated Time</span>
          <span className="hvalue">
            {fmtSimTime(props.simulatedAt)}
            <span className="hvalue-note"> (Day {dayOf(props.tick)})</span>
          </span>
        </span>
      </div>

      <div className="hgroup">
        <span className="hlabel">Scale</span>
        <div className="segmented" role="group" aria-label="Simulation scale">
          {SCALES.map((s) => (
            <button
              key={s}
              type="button"
              className={props.scale === s ? 'seg on' : 'seg'}
              aria-pressed={props.scale === s}
              onClick={() => props.onScale(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      <div className="hgroup hgroup-buttons">
        <button type="button" className="btn" onClick={props.onPause} aria-pressed={props.paused}>
          <PauseIcon size={13} />
          <span>{props.paused ? 'Resume' : 'Pause'}</span>
        </button>
        <button type="button" className="btn" onClick={props.onStep}>
          <StepIcon size={13} />
          <span>Step</span>
        </button>
      </div>

      <div className="hgroup hgroup-seed">
        <label className="hlabel" htmlFor="world-seed">
          Seed
        </label>
        <input
          id="world-seed"
          value={props.seedInput}
          onChange={(e) => props.onSeedInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onReset();
          }}
          inputMode="numeric"
          spellCheck={false}
        />
      </div>

      <button type="button" className="btn btn-reset" onClick={props.onReset}>
        <ResetIcon size={14} />
        <span>Reset</span>
      </button>
    </header>
  );
}
