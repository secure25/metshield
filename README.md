# MetShield (W4) — synthetic fixture

MetShield is a synthetic scam-protection demo. Nothing here is a real Meta
product, a real user, or real data. All accounts, handles, domains, and phone
numbers are invented in obviously synthetic form.

## What W3 has

- `src/contract.ts` — the shared `Observation` type (the only seam between the
  world fixture and the product).
- `src/world/` — seeded RNG, simulated clock, population generation
  (480 accounts, 338 persons, personas from `(seed, personId)`), graph
  (mutual contacts, business followers, groups, cross-surface bridges),
  activity (1-minute ticks, 15 closed event types, templated copy),
  campaigns (4 scam operations, 8 templates, 6-stage machine with hops),
  benign mirror journeys, and the world state container.
- `src/server.ts` — one Express server that serves the API and the console.
- `src/console/` — a minimal React console that prints the world clock.
- `tests/` — determinism, contract privacy boundary, no-unseeded-randomness,
  population, graph, activity, campaigns (funnel rate, hop rules, template
  coverage, journeys, cashout/takeover).

Population: 480 accounts across facebook, whatsapp, messenger; 338 persons
(223×1, 88×2, 27×3 accounts); 48 scam-controlled (8 operator, 40 shell);
`taken_over` is 0 at boot.

Graph: mutual contacts per account, business followers, 12 groups, bridges
for two-surface persons.

Activity: each tick (1 minute) every account acts with probability
`rateScale × actionsPerDay / 1440 × curve(localHour)`, where the local hour
comes from the simulated clock plus the persona's UTC offset and wakeHour
(curve normalized to mean 1). `rateScale` is a per-seed, per-surface calibration
(`theoretical surface total / actual persona total`, ≈0.92–1.08): without it,
seeded persona mixes swing hourly volume ±15% per seed and the 900–1,300
acceptance band cannot hold. Relative persona rates and the curve shape are
untouched. Suggested-view reach is the tuned volume lever (volume scales
near-linearly with it; constants set so the five test seeds land mid-band). Facebook skews public (posts, comments, reactions, ads);
Messenger and WhatsApp skew private (messages with replies, links). A reply
fires only on a pending inbound message over a mutual edge and closes it,
so messages form multi-turn conversations. Posts and ads fan out to
contacts plus suggested viewers (`post_seen`, reactions, comments); views
dominate volume, roughly 1,100 events per simulated hour. Copy is templated
from the actor's interests, group topics, and offers — a few hundred
combinations, no model calls. `surfaceText` is world-internal only and
never leaves the world.

Benign commerce: 6 business pages (2 per surface) publish offers carrying
`payment_handle` indicators with `offer` claim codes; 2 of the 6 add urgency
language (`urgency_phrase`, `urgent`). Each page publishes exactly one
scheduled offer per day (deterministic day-stream tick, independent of
persona activity, so the false-positive material is guaranteed, not
probabilistic) plus whatever it rolls spontaneously. All handles and links
use reserved `.example` names. Viewers attempt payment with probability
`gullibility × 0.05`, exercising the third persona trait.

Groups hold 12–40 members as a maintained invariant: joins respect the 40
cap and invitees/joins come from the legitimate pool only.

Event types (closed, 15): ad_published, post_published, post_seen,
reaction_added, comment_posted, message_sent, group_invite_sent,
group_joined, link_shared, payment_request_shown, credential_request_shown,
payment_attempted, account_taken_over, account_recovered, warning_shown.
The benign engine emits 11 of these; campaigns add `credential_request_shown`
and `account_taken_over`. `account_recovered` and `warning_shown` stay
defined-but-unemitted for the outcome phase (W5).

Campaigns: 8 operators + 40 shells form 4 operations (`OP-1`–`OP-4`, 2
operators + 10 shells each, round-robin by id). Each operation runs one
campaign from a uniform random template. The stage machine runs publish →
exposure → contact → lure → request → cashout with per-stage delay ranges;
the lure stage hops to the next path surface (and cashout to the third on
3-surface paths). A hop picks an operation account on the target surface
held by a different person — never the same account, never the same person —
preferring one that already shares an edge with the victim, else cold with
an `unsolicited_contact` indicator. No edges are ever invented. Each
campaign targets a legitimate person (all accounts legit) covering the full
path and adjacent to the operation on the first surface; without one the
operation skips that seed. Cashout pays out with probability
`gullibility × 0.35`; credential templates cash out via `account_taken_over`
and flip the victim account to `taken_over`.

Claim codes deliberately overlap between scams and benign traffic (`offer`,
`urgent`, `delivery`, `support` appear on both) so the codes alone do not
separate; distinctive codes (`prize`, `investment`, `account-alert`) mark
distinctive claims. Romance grooming carries no indicators until the ask.

Benign journeys (1 per kind per day, deterministic ticks): a retailer's
order link, a friend's group invite, a friend-to-friend payment request
(`split-bill`), and a business support thread (`support`) — all between
legitimate mutual contacts, structurally mirroring the scams.

## Run

```sh
cd metshield
npm install
npm run dev
```

Restart the dev server after updating (no watch mode). Open
http://localhost:5173 in a browser.

- `GET /api/world/state` → `{ seed, tick, simulatedAt, scale, accounts: { total,
  perSurface, operators, shells } }` (tick starts at 180: 3h of boot history)
- `GET /api/world/accounts` → 480 summaries with id, handle, displayName,
  surface, archetype, role
- `GET /api/world/accounts/:id` → `{ account, linkedAccountIds, linkedPersonIds,
  linkedAccounts: [{ id, surface }], bridge | null }`
- `GET /api/world/events` → the event feed in seq order (`?limit=N` for the
  last N; `?seed=` works on all world routes)
- `GET /api/world/campaigns` → campaigns with the stage trail (surface per
  stage for chips) plus operation, template, target, amount, outcome

## Checks

```sh
cd metshield
npm test
npm run check
```

## Changed in W4 (and why)

- New `src/world/campaigns.ts`: operations, 8 templates, spawn targeting,
  6-stage machine, hop picker, cashout/takeover. Required by W4.
- New `src/world/journeys.ts`: 4 benign mirror journeys on deterministic
  day-ticks. Required by W4.
- `WorldState` gained `operations`, `campaigns`, `journeys`; the tick loop
  runs campaigns and journeys after benign activity.
- New `GET /api/world/campaigns`. Required by W4 acceptance.
- W3 message test corrected (see its comment): conversations that start
  with an `unsolicited_contact` first message are exempt from the
  mutual-edge rule; every other message still needs its edge, and
  same-surface still holds for all. The old expectation (no cold contact
  exists) contradicts the contract's own indicator and W4's required
  cross-surface first contact.
- `population.ts`, `graph.ts`, `contract.ts` untouched.

## Changed in W3 (and why)

- New `src/world/activity.ts`: tick engine, fan-out, replies, benign
  commerce, templates. Required by the W3 activity spec.
- `WorldState` gained `events`, `seq`, `pending`; `stepMinute` keeps
  `simulatedAt` in step with `tick` so the clock never goes stale.
- `createWorldState` pre-generates 180 minutes of history so the feed
  renders immediately; per-tick RNG streams keep this deterministic.
- New `GET /api/world/events` with `?limit=`. Required by W3 acceptance.
- `population.ts`, `graph.ts`, `contract.ts` untouched.

## Left out (W4)

- Outcomes/recovery (W5), observation feed (W6), console views (W7).
- No advance endpoint yet (`advanceMinutes` exists; no HTTP route), so the
  running server sits at boot tick +180 with early-stage campaigns.
- No operations listing route.
- Console still prints state JSON only.
- Any product-side correlation, model, card, or validator.
