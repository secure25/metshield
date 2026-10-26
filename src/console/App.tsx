import React from 'react';

interface Clock {
  seed: number;
  tick: number;
  simulatedAt: string;
  scale: number;
  accounts: number;
}

export default function App(): React.JSX.Element {
  const [clock, setClock] = React.useState<Clock | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/world/state')
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
