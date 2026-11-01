# MetShield

MetShield is a proposed additional scam-protection layer for Facebook, Messenger
and WhatsApp that carries a **scam's** context across product boundaries — one
operation, three surfaces, one explanation — and renders that explanation inside
the warning the product already shows.

It does not replace Meta's existing scam alerts: it renders underneath them. It
does not read private conversations — the model is shown the correlation graph,
not the conversation — and it never stores personal data. When the evidence
justifies a warning, it produces a card that names its signals and cites each
one. When it does not, it produces nothing and records why.

**Not a real Meta product.** MetShield has not been built into Facebook,
Messenger or WhatsApp. It is a proposed layer, demonstrated on synthetic and
public data, with no integration with any Meta product. Nothing in this
repository is a real user, a real brand, a real domain, or a real conversation.

The Living World in `src/world/` is the synthetic test fixture MetShield runs
against — invented accounts, campaigns and events — and is not the product; only
this package is submitted, and the product starts and serves its API with the
fixture removed.

## Architecture

```
                 ┌─────────────── sources ───────────────┐
  Living World ────┤ connectors/world.ts   (synthetic)    │
  Public URL feeds ┤ connectors/public.ts  (real, no PII) │
  User submission ─┤ connectors/submit.ts  (+ SAM 3.1)    │
                 └───────────────────┬───────────────────┘
                                     ▼
                         Observation (core contract)
                                     ▼
                   normalize → indicator store → correlate
                                     ▼
                              Cluster (evidence graph)
                                     ▼
                     Muse Spark 1.3  (proposal only)
                   tier + headline + body + citations
                                     ▼
                    validator (deterministic, no model)
                   survive? ──no──▶ silent + reason code
                          │yes
                          ▼
                Card ──▶ emitter ──▶ actions out
                                     ├─ Console: card list
                                     └─ Any surface: JSON
```

Judgement is in exactly two places: the model proposes, the validator disposes.
`src/contract.ts` is the only module the product and the fixture share; the
product never imports from `src/world/` (a test enforces this), and the fixture
is read-only toward the product over HTTP.

## HTTP contract (`/v1`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/health` | liveness, version, model slots, uptime |
| `POST` | `/v1/submissions/link` | check a pasted URL or handle; returns a card or a decline |
| `POST` | `/v1/submissions/creative` | check an uploaded ad creative (multipart); runs SAM, then the pipeline |
| `GET` | `/v1/clusters` | operator view: open operations with per-surface counts |
| `GET` | `/v1/cards` | emitted cards, paged, newest first |
| `GET` | `/v1/cards/:id` | one card with citations, dropped claims and the model proposal |
| `GET` | `/v1/metrics` | eligible / emitted / silent-by-reason / tier mix / cost estimate |

There is no batch-ingest endpoint: observations enter through the three
connectors above, which is the whole input surface.

## Run it

```sh
cd metshield
npm ci
npm run dev        # one server on http://localhost:5173
```

- `http://localhost:5173/console` — operator console: clusters, evidence,
  restraint, and the surface preview.
- `http://localhost:5173/world?seed=42` — fixture console: accounts, campaigns,
  live feed (operator header required; see below).

```sh
npm test           # full suite (27 test files, 243 tests)
npm run check      # tsc --noEmit
npm run demo:world   # fixed world scenario → runs/demo-world-42/report.md
npm run demo:public  # fixed public scenario, no fixture → runs/demo-public-42/report.md
```

Environment (all optional except for live model calls):

| Variable | Purpose |
|---|---|
| `METASHIELD_BASE_URL` / `METASHIELD_API_KEY` | OpenAI-compatible Meta Model API endpoint and key |
| `METASHIELD_LOCALIZER` | localizer model id (default `sam-3.1`) |
| `METASHIELD_RUN_DIR` | run output directory (default `./runs`) |
| `PORT` | server port (default `5173`) |

With nothing set, the service starts, serves `/v1/*`, and accepts submissions;
model calls fail closed to coded declines. The demos use a scripted,
deterministic proposer and are labelled as such in every report.

## Meta models

| Job | Model | Why this one |
|---|---|---|
| Correlate + decide + draft the card | **Muse Spark 1.3** (`muse-spark-1.3-contributor`) | whole-cluster context, structured proposals, permitted to decline |
| Locate the trust anchor in an ad creative | **SAM 3.1** | text prompt → mask for each match; the mask becomes the join key |

Only Meta models are called — never another provider, not for fallback, not for
tests. The SAM `/localize` request shape is assumed pending a first billed call;
until then the creative path is exercised against recorded shapes, and every card
records the model and prompt version behind it.

## The Living World fixture

A synthetic social platform: 480 invented accounts across three surfaces,
ordinary activity, scam operations running multi-step cross-surface campaigns,
and deliberately thin platform warnings. It publishes `Observation` records at
`GET /api/world/observations` (cursor-based, no auth); every other world route
requires the `x-operator-key` header.

Seed contract: every random draw comes from the seeded generator and every
timestamp from the simulated clock. The same seed builds the identical world;
the default seed is `20261026`.

## Limitations

Every run report carries these verbatim under `Limitations` (constants in
`src/honesty.ts`):

- Synthetic volume: most observations in world runs are synthetic fixture
  data; results measure the pipeline, not real users.
- Single-scenario results: one fixed scenario at one seed, not an accuracy
  estimate.
- No real Meta integration.
- No prevalence estimate: no ground-truth labels by design.
- Validator thresholds not tuned on real data.

See [docs/metshield-submission.md](docs/metshield-submission.md) for the full
submission write-up.
