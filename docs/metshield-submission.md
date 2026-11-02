# MetShield — submission

## What was built during the hackathon

Everything in this repository was written during the Meta Global AI Developer
Hackathon window (2026-10-26 – 2026-11-04): all 41 commits, one author, dated
2026-10-26 → 2026-11-03, with no pre-existing code, no vendored third-party
code, and no model weights. Verify with
`git log --format='%h %ad %an %s' --date=short`.

- The opening commit (`55b41c4`, "Import the living world… (W0–W2)") holds the
  scaffold plus Living-World phases W0–W2 only — no product code, zero `/v1/`
  routes at that commit. Every product phase (P0–P13), the model probe, the
  live verification, and the console redesign arrived in the commits after
  it, so "import" reads as what it is: day-one fixture work, not
  pre-existing product.
- The Living World (`src/world/`) is a synthetic test fixture, not the
  product: every observation it emits carries `synthetic: true`, the product
  starts and serves `/v1/*` with `src/world/` removed, and tests enforce both
  the boundary and the flag.
- Track: Indie Developer, solo-built (one author across all commits).
  Problem statement: Build for Your World — bringing Meta's models into
  trust and safety on Meta's own surfaces, a domain known firsthand as a
  user of all three products.
- Nothing predates the event. If that sentence is ever wrong, this section is
  where the exception gets named.
- Built with Muse Code assistance throughout, starting with the Living World
  on opening day; the tooling changes nothing about provenance — every line
  was written inside the window above.

## Problem

Scams move between Facebook, Messenger and WhatsApp faster than warnings do.
A victim sees a paid ad on one surface, a friendly message on a second, and a
payment request on a third — and each surface warns, if it warns at all, about
only what it saw itself. The existing warnings are per-chat and first-contact
scoped, and none of them states its evidence. The operation is cross-product;
the explanation is not.

Reported losses to scams starting on social media run into the billions (the
FTC's $2.1B figure for 2025 covers social media broadly, not Meta alone, and
counts reported losses — actual losses are higher). MetShield does not claim to
end this. It claims a specific, buildable gap: warnings that carry the scam's
context across product boundaries, with citations, rendered where the product
already warns.

## Who benefits

- **People being worked by a scam**, who get an explanation under the warning
  they already see — what matched, where else it appeared, and one safe action —
  instead of a bare "this contact may be a scam".
- **Trust and safety operators**, who get an inspectable console: open
  operations, per-card evidence with dropped claims and rule ids, and a
  restraint panel showing what was deliberately left silent and why.
- **The products themselves**, which get a documented HTTP contract —
  observations in, cards out — that an existing warning slot can render without
  a user installing anything.

## Approach

Observations arrive from three sources — the synthetic Living World over HTTP,
real public URL feeds, and user submissions — into one contract. Indicators are
normalized into a closed vocabulary (domains, payment handles, phones, QR
payloads, brand marks, refs, file hashes); correlation assembles them into
clusters with union-find; a model proposes a card or a decline; a deterministic
validator disposes. The model proposes, the validator disposes, and every claim
that cannot be cited is not rendered.

Three properties carry the design:

1. **Defaults to silence.** Most eligible events produce nothing. `demo:public`
   emits 2 cards and withholds 1; `demo:world` emits 3 and withholds 1 — and
   each report prints the silence with its reason code beside the cards.
2. **Every claim is cited.** Each citation resolves deterministically to an
   observation on a surface other than the one being warned. The model names
   indicator ids; code builds the citations; the validator checks them. The
   same rule covers copy slots: template values (counts, dates, feed names)
   are recomputed from evidence before validation, because a live run showed
   the model cannot know them — it wrote the surface name for the feed and
   guessed the relative time.
3. **Privacy is structural.** Observations cannot carry message text
   (`raw?: never` is a compile error); the model sees the correlation graph,
   never the conversation; `actorRef` is minted per submission, never a key,
   never copied into a cluster, card or log.

## Where this hooks in (proposal, not integration)

No integration with any Meta product exists; the surface preview in the console
is a labelled rendering of the payload, not a hook. What exists is the contract
(`observations in, cards out`) and this sketch of the three emitters that would
feed it, each publishing metadata its surface already computes:

1. **Ad review** — the ad platform already scans creatives and destination
   links pre-flight. It emits link and creative observations (domains, handles,
   file hashes) for ads that run.
2. **Link-warning services** — WhatsApp and Messenger already check link
   reputation to draw previews and link warnings. They emit domain observations
   for links seen in chats, which is metadata already crossing the boundary
   today, not new content access.
3. **On-device classifiers** — WhatsApp's existing on-device Scam Alert already
   computes signals on the device for non-contact chats. It emits opaque signal
   observations (claim codes plus indicator metadata, never conversation text).

The graph is therefore built from metadata surfaces already hold, and the card
renders in the warning slot the product already owns. Inside Meta this is a
plausible internal signal-sharing design; as an external product it would need
these emitters to exist, which is why the submission claims a proposal, not a
deployment.

## Cognitive load (design hypothesis, not measured benefit)

Short warning text under stress is a deliberate choice, and MetShield does not
argue against it: the existing warning stays exactly as it is. The card renders
*beneath* it, for the deliberation moment rather than the panic moment —
verifying, reporting, showing a bank — with its own budgets (headline ≤ 90
chars, body ≤ 320, one safe action, citations as chips, details one step away).
The claim is narrower than "more evidence is better": a warning with no evidence
cannot be argued with, verified, or repeated to a third party, and citations
serve that reportability. No comprehension or usability data supports this yet;
the falsifiable version — users report more often and decide better with cited
cards — is future work, stated here so it is not mistaken for a result.

## How each Meta model is used, and why that model

**Muse Spark 1.3 (contributor tier)** — `proposeCard` sends the serialized
cluster only: canonical indicator values, families, surfaces, counts, time
deltas, claim codes. It returns a proposal (emit/decline, tier, headline, body,
safe action, cited indicator ids) or a coded decline. It is the reasoner because
a whole cross-product cluster fits in context, it emits structured proposals
that validate against a schema, and it is explicitly permitted to decline —
declining is a first-class result, not a parse failure. Temperature 0.2, reasoning
effort minimal (the probe showed default-effort reasoning dominating latency on
this constrained task). Every
card records `muse-spark-1.3-contributor` and the prompt version.

**SAM 3.1** — `locateAnchors` sends a submitted creative with five short noun
phrases (`payment handle`, `QR code`, `contact button`, `brand logo`,
`price or offer amount`) and receives masks; each masked region is cropped.
The mask itself is the citation: the region SAM found is the evidence for
"this creative carries that anchor", with no text extraction required and
none claimed on raster. Vector text inside a masked region (SVG creatives)
is read deterministically in offline tests — but the live endpoint rejects
vectors (HTTP 400, measured) and returns boxes only for raster, so the live
end-to-end mask→text→card chain is unmeasured: one logo region over two
fixtures and ten phrase-calls, zero handle regions. Raster submissions
record their boxes and decline on evidence rather than guess. It is the localizer because the trust anchor
of a scam ad is visual — printed onto the image, not in the caption — and
because masks are verifiable in a way a chat model's reading of a picture is
not. SAM localizes; it never judges. The request shape (POST
`{base}/responses`, one noun phrase per call) and the grammar parse are
verified by billed probe calls; mask payloads are kept opaque because raster
decode is not implemented.

No other AI provider is called at runtime, in development, or in tests. Only
Meta models appear in the tree.

## What is measured, and what is not

Measured, per run, in `metrics.json` and the report:

- Source mix and synthetic share (every world observation is labeled).
- Open clusters; cards by tier (`context` / `corroborated` / `confirmed`).
- Declines by reason code, demotions by validator rule, `would-have-been` tiers.
- Model calls, mean latency, and a cost estimate metered from recorded tokens
  at contributor rates — never hard-coded.

Not measured, by design: scam prevalence, detector precision/recall, or accuracy
against real users. The fixture carries no ground-truth labels the product can
see, the validator's thresholds were set by judgment against synthetic
scenarios, and each report covers one fixed scenario at one seed. These are
single-scenario engineering runs proving the pipeline behaves — emits when
justified, refuses when not — not efficacy claims.

## Limitations

Verbatim from `src/honesty.ts`, rendered in every run report:

- Synthetic volume: most observations in world runs are synthetic fixture data, and every world-sourced observation is labeled synthetic:true; results measure the pipeline, not real users.
- Single-scenario results: each report covers one fixed scenario at one seed, not a sweep; its numbers are engineering evidence from that run, not an accuracy estimate.
- No real Meta integration: MetShield has not been built into Facebook, Messenger, or WhatsApp; it is a proposed layer demonstrated on synthetic and public data.
- No prevalence estimate: nothing here estimates scam prevalence or detector precision/recall; the run contains no ground-truth labels by design.
- Validator thresholds not tuned on real data: citation counts, tiers, and time windows were set by judgment against synthetic scenarios, not fitted to real-world measurements.
