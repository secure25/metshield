import React from 'react';
import type { AccountSummary, Surface } from './api';
import { SURFACE_META, fmtCount, fmtRole, hueOf, initialsOf } from './format';
import { ChevronIcon, FilterIcon, SearchIcon, UsersIcon } from './icons';

interface Props {
  accounts: AccountSummary[];
  filter: Surface | 'all';
  onFilter: (filter: Surface | 'all') => void;
  onOpen: (id: string) => void;
}

const PAGE_SIZE = 10;

function pageItems(current: number, count: number): Array<number | 'gap'> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const out: Array<number | 'gap'> = [0];
  if (current > 3) out.push('gap');
  const from = Math.max(1, current - 1);
  const to = Math.min(count - 2, current + 1);
  for (let i = from; i <= to; i++) out.push(i);
  if (current < count - 4) out.push('gap');
  out.push(count - 1);
  return out;
}

export default function AccountsPanel(props: Props): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(0);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return props.accounts.filter((a) => {
      if (props.filter !== 'all' && a.surface !== props.filter) return false;
      if (needle.length === 0) return true;
      return a.handle.toLowerCase().includes(needle) || a.displayName.toLowerCase().includes(needle);
    });
  }, [props.accounts, props.filter, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);

  React.useEffect(() => {
    setPage(0);
  }, [props.filter, query]);

  const start = current * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);
  const first = filtered.length === 0 ? 0 : start + 1;
  const last = Math.min(start + PAGE_SIZE, filtered.length);

  return (
    <section className="panel panel-accounts" aria-label="Accounts">
      <div className="panel-head">
        <span className="head-icon" aria-hidden="true">
          <UsersIcon size={16} />
        </span>
        <h2>Accounts</h2>
        <span className="count">{fmtCount(props.accounts.length)} accounts</span>
      </div>

      <div className="panel-toolbar">
        <label className="search">
          <SearchIcon size={14} />
          <input
            type="search"
            placeholder="Search accounts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search accounts by handle or name"
          />
        </label>
        <div className="select-wrap">
          <FilterIcon size={14} />
          <select
            aria-label="Filter by surface"
            value={props.filter}
            onChange={(e) => props.onFilter(e.target.value as Surface | 'all')}
          >
            <option value="all">All surfaces</option>
            <option value="facebook">Facebook</option>
            <option value="messenger">Messenger</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </div>
      </div>

      <div className="thead acct-grid">
        <span>Avatar</span>
        <span>Handle</span>
        <span>Surface</span>
        <span>Archetype</span>
        <span>Role</span>
        <span aria-hidden="true" />
      </div>

      <div className="panel-body">
        {rows.length === 0 ? (
          <p className="empty">{props.accounts.length === 0 ? 'Loading accounts…' : 'No accounts match this filter.'}</p>
        ) : (
          <ul className="acct-list">
            {rows.map((a) => (
              <li key={a.id}>
                <button type="button" className="acct-row acct-grid" onClick={() => props.onOpen(a.id)}>
                  <span className="avatar" style={{ backgroundColor: `hsl(${hueOf(a.id)} 42% 30%)` }}>
                    {initialsOf(a.displayName)}
                  </span>
                  <span className="acct-handle" title={`${a.displayName} · ${a.id}`}>
                    @{a.handle}
                  </span>
                  <span>
                    <span className={`chip ${SURFACE_META[a.surface].cls}`}>{SURFACE_META[a.surface].label}</span>
                  </span>
                  <span className="cell-muted" title={a.archetype}>
                    {fmtRole(a.archetype)}
                  </span>
                  <span className="cell-muted" title={a.role}>
                    {fmtRole(a.role)}
                  </span>
                  <span className="chev" aria-hidden="true">
                    <ChevronIcon size={13} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="panel-foot">
        <span>
          Showing {first}–{last} of {fmtCount(filtered.length)}
        </span>
        <div className="pager">
          <button
            type="button"
            className="pg pg-prev"
            onClick={() => setPage(Math.max(0, current - 1))}
            disabled={current === 0}
            aria-label="Previous page"
          >
            <ChevronIcon size={12} />
          </button>
          <div className="pg-list">
            {pageItems(current, pageCount).map((item, i) =>
              item === 'gap' ? (
                <span key={`gap-${i}`} className="pg-gap">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={item === current ? 'pg pg-num on' : 'pg pg-num'}
                  onClick={() => setPage(item)}
                  aria-current={item === current ? 'page' : undefined}
                >
                  {item + 1}
                </button>
              )
            )}
          </div>
          <button
            type="button"
            className="pg pg-next"
            onClick={() => setPage(Math.min(pageCount - 1, current + 1))}
            disabled={current >= pageCount - 1}
            aria-label="Next page"
          >
            <ChevronIcon size={12} />
          </button>
        </div>
      </footer>
    </section>
  );
}
