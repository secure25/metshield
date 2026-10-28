import React from 'react';
import '../world.css';
import {
  api,
  type WorldSummary,
  type AccountSummary,
  type CampaignDTO,
  type WorldEventDTO,
  type WorldTruth,
  type IntegrityDTO,
  type Surface
} from './api';
import ClockStrip from './ClockStrip';
import AccountsPanel from './AccountsPanel';
import AccountDrawer from './AccountDrawer';
import CampaignsPanel from './CampaignsPanel';
import CampaignTrailCard from './CampaignTrailCard';
import FeedPanel from './FeedPanel';
import WarningsCard from './WarningsCard';
import RegionCard from './RegionCard';
import { SURFACE_META, fmtCount, hueOf, initialsOf } from './format';

import creative1 from '../../world/assets/creatives/creative-1.svg';
import creative2 from '../../world/assets/creatives/creative-2.svg';
import creative3 from '../../world/assets/creatives/creative-3.svg';
import creative4 from '../../world/assets/creatives/creative-4.svg';
import creative5 from '../../world/assets/creatives/creative-5.svg';
import creative6 from '../../world/assets/creatives/creative-6.svg';

const CREATIVES = [creative1, creative2, creative3, creative4, creative5, creative6];

// Region 1 lists this many accounts next to the inline drawer.
const MINI_ROWS = 9;

interface Props {
  initialSeed: number;
}

export default function WorldPage(props: Props): React.JSX.Element {
  const [seed, setSeed] = React.useState(props.initialSeed);
  const [seedInput, setSeedInput] = React.useState(String(props.initialSeed));
  const [scale, setScale] = React.useState(60);
  const [paused, setPaused] = React.useState(false);
  const [summary, setSummary] = React.useState<WorldSummary | null>(null);
  const [accounts, setAccounts] = React.useState<AccountSummary[]>([]);
  const [campaigns, setCampaigns] = React.useState<CampaignDTO[]>([]);
  const [feed, setFeed] = React.useState<WorldEventDTO[]>([]);
  const [truth, setTruth] = React.useState<WorldTruth | null>(null);
  const [integrity, setIntegrity] = React.useState<IntegrityDTO | null>(null);
  const [operatorView, setOperatorView] = React.useState(false);
  const [surfaceFilter, setSurfaceFilter] = React.useState<Surface | 'all'>('all');
  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = React.useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = React.useState<string | null>(null);
  const [eventLimit, setEventLimit] = React.useState(200);
  const [error, setError] = React.useState<string | null>(null);
  const pollCount = React.useRef(0);

  const refresh = React.useCallback(
    async (withAccounts: boolean, withTruth: boolean) => {
      try {
        const [s, c, e] = await Promise.all([
          api.state(seed),
          api.campaigns(seed),
          api.events(seed, eventLimit)
        ]);
        setSummary(s);
        setCampaigns(c);
        setFeed([...e].reverse());
        if (withAccounts) setAccounts(await api.accounts(seed));
        if (withTruth) {
          const [t, i] = await Promise.all([api.truth(seed), api.integrity(seed)]);
          setTruth(t);
          setIntegrity(i);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'refresh failed');
      }
    },
    [seed, eventLimit]
  );

  React.useEffect(() => {
    pollCount.current = 0;
    setDrawerId(null);
    void refresh(true, operatorView);
  }, [seed, refresh, operatorView]);

  // Region 1 is the linked-account view: it lists accounts that actually span
  // surfaces, best-linked first and cycling through the surfaces so the column
  // stays legible. The drawer opens on the first row.
  const miniRows = React.useMemo(() => {
    const SURFACE_ORDER: Surface[] = ['facebook', 'messenger', 'whatsapp'];
    const bySurface = new Map<Surface, AccountSummary[]>();
    for (const a of accounts) {
      const list = bySurface.get(a.surface);
      if (list) list.push(a);
      else bySurface.set(a.surface, [a]);
    }
    for (const list of bySurface.values()) {
      list.sort((a, b) => b.linkedAccountCount - a.linkedAccountCount || (a.id < b.id ? -1 : 1));
    }
    const out: AccountSummary[] = [];
    for (let rank = 0; out.length < MINI_ROWS; rank++) {
      let added = false;
      for (const surface of SURFACE_ORDER) {
        const a = bySurface.get(surface)?.[rank];
        if (!a || a.linkedAccountCount === 0) continue;
        out.push(a);
        added = true;
        if (out.length >= MINI_ROWS) break;
      }
      if (!added) break;
    }
    return out.length > 0 ? out : accounts.slice(0, MINI_ROWS);
  }, [accounts]);

  React.useEffect(() => {
    setSelectedAccountId((current) =>
      current && accounts.some((a) => a.id === current) ? current : (miniRows[0]?.id ?? accounts[0]?.id ?? null)
    );
  }, [accounts, miniRows]);

  // Region 2 shows a trail that hops between surfaces, so the default pick is
  // the campaign with the longest cross-surface path.
  React.useEffect(() => {
    setSelectedCampaignId((current) => {
      if (current && campaigns.some((c) => c.id === current)) return current;
      const hoppers = [...campaigns].sort((a, b) => b.path.length - a.path.length || (a.id < b.id ? -1 : 1));
      return hoppers[0]?.id ?? campaigns[0]?.id ?? null;
    });
  }, [campaigns]);

  React.useEffect(() => {
    if (paused) return;
    // A high scale takes longer server-side than one interval tick. Without a
    // guard the interval stacks advances and the page never catches up.
    let busy = false;
    const timer = setInterval(() => {
      // A hidden panel keeps no requests in flight: the console polls while it
      // is being watched, not while it sits in a background tab.
      if (busy || document.hidden) return;
      busy = true;
      (async () => {
        try {
          await api.advance(seed, scale);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'advance failed');
          return;
        }
        pollCount.current += 1;
        await refresh(pollCount.current % 15 === 0, operatorView);
      })().finally(() => {
        busy = false;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [paused, scale, seed, refresh, operatorView]);

  const onStep = React.useCallback(() => {
    (async () => {
      try {
        await api.advance(seed, 1);
        await refresh(false, operatorView);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'step failed');
      }
    })();
  }, [seed, refresh, operatorView]);

  const onReset = React.useCallback(() => {
    const n = Number.parseInt(seedInput, 10);
    if (Number.isFinite(n)) setSeed(n);
  }, [seedInput]);

  const accountsById = React.useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const handleOf = React.useCallback((id: string) => accountsById.get(id)?.handle ?? null, [accountsById]);

  return (
    <div className="world">
      <ClockStrip
        tick={summary?.tick ?? 0}
        simulatedAt={summary?.simulatedAt ?? ''}
        scale={scale}
        onScale={setScale}
        paused={paused}
        onPause={() => setPaused((p) => !p)}
        onStep={onStep}
        seedInput={seedInput}
        onSeedInput={setSeedInput}
        onReset={onReset}
      />
      {error ? <p className="error banner">Error: {error}</p> : null}

      <div className="columns">
        <AccountsPanel
          accounts={accounts}
          filter={surfaceFilter}
          onFilter={setSurfaceFilter}
          onOpen={setDrawerId}
        />
        <CampaignsPanel campaigns={campaigns} selectedId={selectedCampaignId} onSelect={setSelectedCampaignId} />
        <FeedPanel
          events={feed}
          handleOf={handleOf}
          operatorView={operatorView}
          onToggleOperator={() => setOperatorView((v) => !v)}
          integrity={integrity}
          scamIds={truth ? new Set(truth.scamEventIds) : null}
          totalEvents={feed.length > 0 ? feed[0].seq : 0}
          onViewAll={() => setEventLimit(2000)}
        />
      </div>

      <div className="regions">
        <RegionCard
          index={1}
          title="Accounts → Account Drawer → Linked Account"
          description="Click an account in the list to open the detail drawer, showing linked accounts on other surfaces."
        >
          <div className="region-split">
            <div className="mini-accounts" role="list" aria-label="Accounts">
              <div className="mini-head" aria-hidden="true">
                <span>Avatar</span>
                <span>Handle</span>
                <span>Surface</span>
              </div>
              {accounts.length === 0 ? <p className="empty small">Loading accounts…</p> : null}
              {miniRows.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={a.id === selectedAccountId ? 'mini-acct on' : 'mini-acct'}
                  onClick={() => setSelectedAccountId(a.id)}
                  aria-pressed={a.id === selectedAccountId}
                >
                  <span className="avatar sm" style={{ backgroundColor: `hsl(${hueOf(a.id)} 42% 30%)` }}>
                    {initialsOf(a.displayName)}
                  </span>
                  <span className="mini-handle">@{a.handle}</span>
                  <span className={`chip ${SURFACE_META[a.surface].cls}`}>{SURFACE_META[a.surface].label}</span>
                  <span className="chev" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
            {selectedAccountId ? (
              <AccountDrawer
                variant="inline"
                seed={seed}
                accountId={selectedAccountId}
                simulatedAt={summary?.simulatedAt ?? ''}
                onOpen={setSelectedAccountId}
              />
            ) : (
              <p className="empty small">Select an account.</p>
            )}
          </div>
        </RegionCard>

        <RegionCard
          index={2}
          title="Campaign Trail"
          description="Click a campaign above to see the stage trail with a visible hop across surfaces."
        >
          <CampaignTrailCard
            campaigns={campaigns}
            selectedId={selectedCampaignId}
            onSelect={setSelectedCampaignId}
            handleOf={handleOf}
          />
        </RegionCard>

        <RegionCard
          index={3}
          title="Live Feed with Warnings"
          description="Click a row to see the full event details. Truth tag is hidden by default."
        >
          <WarningsCard
            events={feed}
            handleOf={handleOf}
            operatorView={operatorView}
            onToggleOperator={() => setOperatorView((v) => !v)}
            integrity={integrity}
            scamIds={truth ? new Set(truth.scamEventIds) : null}
          />
        </RegionCard>

        <RegionCard
          index={4}
          title="Six Synthetic Creatives"
          description="Each image contains a payment handle in a fixed corner region for masking and validation."
          className="region-creatives"
        >
          <div className="creative-grid">
            {CREATIVES.map((src, i) => (
              <figure key={src} className="creative">
                <img
                  src={src}
                  alt={`Synthetic creative ${i + 1} with a payment handle baked into a corner`}
                  loading="lazy"
                />
              </figure>
            ))}
          </div>
        </RegionCard>
      </div>

      <footer className="world-foot">
        <span className="dot green" aria-hidden="true" />
        <span>Simulated world — no real people, no real platform data, no real products.</span>
        <span className="muted">
          {summary ? `${fmtCount(summary.accounts.total)} accounts across 3 surfaces` : 'Surfaces: Facebook · WhatsApp · Messenger'}
        </span>
      </footer>

      {drawerId ? (
        <AccountDrawer
          seed={seed}
          accountId={drawerId}
          simulatedAt={summary?.simulatedAt ?? ''}
          onOpen={setDrawerId}
          onClose={() => setDrawerId(null)}
        />
      ) : null}
    </div>
  );
}
