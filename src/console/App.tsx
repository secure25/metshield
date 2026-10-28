import React from 'react';
import WorldPage from './world/WorldPage';

function seedFromLocation(): number {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const n = raw === null || raw === '' ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 42;
}

interface Clock {
  seed: number;
  tick: number;
  simulatedAt: string;
  scale: number;
  accounts: number;
}

export default function App(): React.JSX.Element {
  if (window.location.pathname === '/world' || window.location.pathname.startsWith('/world/')) {
    return <WorldPage initialSeed={seedFromLocation()} />;
  }
  return <ClockView />;
}

function ClockView(): React.JSX.Element {
  const [clock, setClock] = React.useState<Clock | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Fixture key (see server operatorAuth): state is an operator route.
    fetch('/api/world/state', { headers: { 'x-operator-key': 'metshield-local-operator' } })
      .then((res) => res.json() as Promise<Clock>)
      .then(setClock)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'fetch failed');
      });
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 720 }}>
      <h1>MetShield Console — synthetic fixture</h1>
      <p>Simulated demo only. Not a real Meta product, not real users, not real data.</p>
      {error ? <p>Error: {error}</p> : null}
      <pre>{clock ? JSON.stringify(clock, null, 2) : 'loading…'}</pre>
    </main>
  );
}
