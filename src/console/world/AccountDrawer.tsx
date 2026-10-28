import React from 'react';
import { api, type AccountDetailResponse, type WorldEventDTO } from './api';
import {
  SURFACE_META,
  eventLabel,
  fmtClock,
  fmtCompact,
  fmtRole,
  hueOf,
  initialsOf,
  joinDate
} from './format';
import { ChevronIcon, CloseIcon } from './icons';

interface Props {
  seed: number;
  accountId: string;
  simulatedAt: string;
  variant?: 'overlay' | 'inline';
  onOpen: (id: string) => void;
  onClose?: () => void;
}

export default function AccountDrawer(props: Props): React.JSX.Element {
  const inline = props.variant === 'inline';
  const [detail, setDetail] = React.useState<AccountDetailResponse | null>(null);
  const [recent, setRecent] = React.useState<WorldEventDTO[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let dead = false;
    const limit = inline ? 6 : 12;
    setDetail(null);
    setRecent([]);
    setError(null);
    (async () => {
      try {
        // Two small, account-scoped reads: the feed buffer holds the newest
        // events of the whole world, which an arbitrary account rarely appears in.
        const [d, evts] = await Promise.all([
          api.account(props.seed, props.accountId),
          api.accountEvents(props.seed, props.accountId, limit)
        ]);
        if (dead) return;
        setDetail(d);
        setRecent([...evts].reverse());
      } catch (err) {
        if (!dead) setError(err instanceof Error ? err.message : 'load failed');
      }
    })();
    return () => {
      dead = true;
    };
  }, [props.seed, props.accountId, inline]);

  React.useEffect(() => {
    if (inline || !props.onClose) return;
    const close = props.onClose;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose, inline]);

  const account = detail?.account ?? null;

  return (
    <aside className={inline ? 'drawer inline' : 'drawer'} aria-label="Account detail">
      {error ? <p className="error">Error: {error}</p> : null}
      {!account ? (
        <p className="empty">Loading account…</p>
      ) : (
        <>
          <header className="drawer-top">
            <span className="avatar xl" style={{ backgroundColor: `hsl(${hueOf(account.id)} 42% 30%)` }}>
              {initialsOf(account.displayName)}
            </span>
            <div className="drawer-id">
              <strong>@{account.handle}</strong>
              <span className="muted">
                {account.kind === 'business' ? 'Business' : 'Person'} · {fmtRole(account.role)}
              </span>
              <span>
                <span className={`chip ${SURFACE_META[account.surface].cls}`}>{SURFACE_META[account.surface].label}</span>
                {account.verified ? <span className="muted verified"> · verified</span> : null}
              </span>
            </div>
            {props.onClose ? (
              <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Close account detail">
                <CloseIcon size={15} />
              </button>
            ) : null}
          </header>

          <p className="drawer-bio">{account.bio}</p>

          <div className="figures">
            <div>
              <span className="fig-label">Joined</span>
              <strong>{joinDate(props.simulatedAt, account.joinedMonthsAgo)}</strong>
            </div>
            <div>
              <span className="fig-label">Followers</span>
              <strong>{fmtCompact(account.followerCount)}</strong>
            </div>
            <div>
              <span className="fig-label">Following</span>
              <strong>{fmtCompact(account.followingCount)}</strong>
            </div>
          </div>

          <h4>Persona traits</h4>
          <div className="traits">
            <span className="trait">{fmtRole(account.persona.archetype)}</span>
            {account.persona.interests.map((i) => (
              <span key={i} className="trait">
                {i}
              </span>
            ))}
          </div>

          <h4>Linked accounts</h4>
          {detail && detail.linkedAccounts.length === 0 ? (
            <p className="empty small">No accounts on other surfaces.</p>
          ) : null}
          <ul className="link-list">
            {(detail?.linkedAccounts ?? []).map((l) => (
              <li key={l.id}>
                <button type="button" className="link-row" onClick={() => props.onOpen(l.id)}>
                  <span className={`chip ${SURFACE_META[l.surface].cls}`}>{SURFACE_META[l.surface].label}</span>
                  <span className="link-handle">@{l.handle}</span>
                  <span className="chev" aria-hidden="true">
                    <ChevronIcon size={12} />
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <h4>Last {recent.length} events</h4>
          {recent.length === 0 ? <p className="empty small">No events in the current buffer.</p> : null}
          <ul className="mini-feed">
            {recent.map((e) => (
              <li key={e.id} className="mini-row">
                <span className="mini-time">{fmtClock(e.simMinute)}</span>
                <span className="mini-type">{eventLabel(e.type)}</span>
                <span>
                  <span className={`chip ${SURFACE_META[e.surface].cls}`}>{SURFACE_META[e.surface].label}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
