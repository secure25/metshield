# MetShield — synthetic living world

A scam-protection demo: a synthetic social world across three invented
surfaces (facebook, messenger, whatsapp) where 480 accounts post, message,
and trade while four scam operations run multi-step, cross-surface
campaigns against them — and a public observation feed projects it all as
`Observation` records. The world also emits deliberately thin platform
warnings; the product's argument is that richer, cited warnings are needed.

Nothing here is real: no real people, brands, domains, handles, or phone
numbers. Every name, handle, business, and payment reference is generated
from invented syllable pools in obviously synthetic form (`.example`
domains, dotted handles), and every record is marked synthetic.

## Run it

```sh
cd metshield
npm install
npm run dev
```

Open http://localhost:5173/world?seed=42 for the operator console
(accounts, campaigns, live feed), or `/` for the minimal clock view.

```sh
npm test        # the suite: determinism, population, graph, campaigns,
                # outcomes, observations, api, creatives, watchdog
npx tsc --noEmit
```

Routes: `state`, `accounts`, `accounts/:id`, `events`, `events/:id`,
`campaigns`, `campaigns/:id`, `integrity`, `truth`, `observations`
(`?cursor=N&limit=M`), and `POST control { minutes }` to advance time.
`?seed=` works on all world GET routes.

## Seed contract

Every random draw comes from the world's seeded generator and every
timestamp from its simulated clock — never from ambient randomness or wall
time. The same seed therefore builds the identical world: same population,
same graph, same events at the same ticks, advancing in any batch sizes.
The default seed is `20261026`; the observation cursor is the last consumed
event seq, so a client holding a cursor gets exactly the unconsumed suffix
after a restart.

All operator pages and world routes except the public observations feed
require the `x-operator-key` header.
