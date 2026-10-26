# MetShield (W2) — synthetic fixture

MetShield is a synthetic scam-protection demo. Nothing here is a real Meta
product, a real user, or real data. All accounts, handles, domains, and phone
numbers are invented in obviously synthetic form.

## What W2 has

- `src/contract.ts` — the shared `Observation` type (the only seam between the
  world fixture and the product).
- `src/world/` — seeded RNG, simulated clock, population generation
  (480 accounts, 338 persons, personas from `(seed, personId)`), graph
  (mutual contacts, business followers, groups, cross-surface bridges), and
  the world state container.
- `src/server.ts` — one Express server that serves the API and the console.
- `src/console/` — a minimal React console that prints the world clock.
- `tests/` — determinism, contract privacy boundary, no-unseeded-randomness,
  population, graph (mutuality, bridges, groups, followers).

Population: 480 accounts across facebook, whatsapp, messenger; 338 persons
(223×1, 88×2, 27×3 accounts); 48 scam-controlled (8 operator, 40 shell);
`taken_over` is 0 at boot. Names, handles, and bios are composed from invented
per-city syllable pools. Avatars are initials + `hue = avatarSeed % 360`; no
image requests.

Graph: each account holds 2–4 close ties plus 4–9 acquaintances on its own
surface (minimums exact, maximums soft — a picked partner can land 1–2 over);
every edge is stored once and read from both ends. Business pages hold 30–60
one-way followers from the same-surface legitimate pool. 12 groups
(`GRP-<surface>-<n>`, 4 per surface, 12–40 legitimate members) with invented
names and topics. Every exactly-two-surface person holds exactly one bridge:
a mutual tie present on both surfaces, keyed by personId (odd leftovers pair
with a distinct three-surface person; bridge edges count as close contacts).

## Run

```sh
cd metshield
npm install
npm run dev
```

Restart the dev server after updating (no watch mode). Open
http://localhost:5173 in a browser.

- `GET /api/world/state` → `{ seed, tick, simulatedAt, scale, accounts: { total,
  perSurface, operators, shells } }`
- `GET /api/world/accounts` → 480 summaries with id, handle, displayName,
  surface, archetype, role
- `GET /api/world/accounts/:id` → `{ account, linkedAccountIds, linkedPersonIds,
  linkedAccounts: [{ id, surface }], bridge | null }`

## Checks

```sh
cd metshield
npm test
npm run check
```

## Changed in W2 (and why)

- New `src/world/graph.ts`: contact/follow/group/bridge generation plus the
  `contactsOf` / `closeTiesOf` / `followersOf` both-ends readers. Required by
  the W2 graph spec.
- `WorldState` gained `graph`: the graph rides with the seeded state so every
  seed fully determines it.
- Added `shuffle` to `rng.ts`: shared seeded helper for group/follower draws
  (not a new PRNG).
- `GET /api/world/accounts/:id` gained `linkedAccounts` (id + surface) and
  `bridge`: required by W2 acceptance. Old fields kept.
- `population.ts` untouched.

## Left out (W2)

- Activity, campaigns, outcomes, observation feed.
- No `/api/world/groups` or contacts listing routes yet.
- Three-surface persons hold no bridge of their own (at most partner records
  for odd leftovers); revisit if campaign hops need them.
- Console still prints state JSON only.
- Any product-side correlation, model, card, or validator.
