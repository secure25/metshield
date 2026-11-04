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
repository is a real user, a real brand, a real scam-target domain, or a real conversation.

The Living World in `src/world/` is the synthetic test fixture MetShield runs
against — invented accounts, campaigns and events — and is not the product; only
this package is submitted, and the product starts and serves its API with the
fixture removed.

Everything in this repository was written during the Meta Global AI Developer
Hackathon (Oct 26 – Nov 4, 2026): all 49 commits, one author, no pre-existing
code. Provenance details and verification commands are in
[docs/metshield-submission.md](docs/metshield-submission.md#what-was-built-during-the-hackathon).

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
npm test           # full suite (30 test files, 272 tests)
npm run check      # tsc --noEmit
npm run demo:world   # fixed world scenario → runs/demo-world-42/report.md
npm run demo:public  # fixed public scenario, no fixture → runs/demo-public-42/report.md
```

## Reproduce the demo

Every number in the submission video regenerates locally. Only the
starred row needs a key (see `.env.example`); the rest run keyless.

| Video beat | Command | Expected |
|---|---|---|
| The link (clusters) | `npm run demo:world` | 8006 observations, 30 clusters, 3 cards |
| The card + proof (live) | `npm run live:public -- <two feed-listed domains>`* | 2 `confirmed` cards, 0 synthetic observations |
| The decline | `npm run live:public -- notlisted-x.example` | `card: null`, `ineligible_cluster` |
| The validator refusal | `npm run demo:world`, then read `runs/demo-world-42/cards.jsonl` | declined lines with `V11`/`V2` rule ids |

Environment (all optional except for live model calls):

| Variable | Purpose |
|---|---|
| `METASHIELD_BASE_URL` / `METASHIELD_API_KEY` | OpenAI-compatible Meta Model API endpoint (e.g. `https://api.meta.ai/v1` — the `/v1` path is part of the URL) and key |
| `METASHIELD_LOCALIZER` | localizer model id (default `sam-3.1`) |
| `METASHIELD_RUN_DIR` | run output directory (default `./runs`) |
| `PORT` | server port (default `5173`) |
| `WORLD_BASE_URL` / `WORLD_POLL_MS` | Living-World ingest at boot (e.g. `http://127.0.0.1:5173`, `5000`); unset = off |
| `LIVE_FEED_URL` (+ `LIVE_FEED_NAME/FORMAT/CLAIM/MAX_ITEMS/PUBLISHED_AT`) | public feed ingest at boot and for `live:public`; unset = off (see `.env.example`) |

With nothing set, the service starts, serves `/v1/*`, and accepts submissions;
card building without model vars answers `pipeline_error` (HTTP 500) rather
than a coded decline (known gap — see Limitations); configured model failures
decline with codes. The demos use a scripted, deterministic proposer and are
labelled as such in every report.

## Meta models

| Job | Model | Why this one |
|---|---|---|
| Correlate + decide + draft the card | **Muse Spark 1.3** (`muse-spark-1.3-contributor`) | whole-cluster context, structured proposals, permitted to decline |
| Locate the trust anchor in an ad creative | **SAM 3.1** | text prompt → mask for each match; the mask itself is the citation (live text extraction unmeasured — see `docs/model-probe.md`) |

Only Meta models are called — never another provider, not for fallback, not for
tests. The SAM request shape (POST `{base}/responses`, one noun phrase per call)
and the grammar parse are verified by billed probe calls; see
[docs/model-probe.md](docs/model-probe.md). Every card records the model and
prompt version behind it.

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

- Synthetic volume: most observations in world runs are synthetic fixture data, and every world-sourced observation is labeled synthetic:true; results measure the pipeline, not real users.
- Single-scenario results: each report covers one fixed scenario at one seed, not a sweep; its numbers are engineering evidence from that run, not an accuracy estimate.
- No real Meta integration: MetShield has not been built into Facebook, Messenger, or WhatsApp; it is a proposed layer demonstrated on synthetic and public data.
- No prevalence estimate: nothing here estimates scam prevalence or detector precision/recall; the run contains no ground-truth labels by design.
- Validator thresholds not tuned on real data: citation counts, tiers, and time windows were set by judgment against synthetic scenarios, not fitted to real-world measurements.

See [docs/metshield-submission.md](docs/metshield-submission.md) for the full
submission write-up.
