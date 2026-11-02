# Model probe — measured 2026-11-01

Billed calls against the Meta Model API (`https://api.meta.ai/v1`), run via
`npm run probe:models` (see `scripts/probe-models.ts`). The full JSON report
lives in `runs/model-probe.json`, which is gitignored; the numbers below are
transcribed from it. No key, no fixture bytes, no local paths.

## Reasoner — `muse-spark-1.3-contributor`

- Transport: `POST {base}/chat/completions`, `json_schema` response format
  accepted.
- Key authenticates; model id exists; $150 grant live (tier string and rate
  limits are not surfaced by the transports, so they are not recorded).
- Reasoning parameter: flat `reasoning_effort: "minimal"` accepted; nested
  `reasoning.effort` returns HTTP 400. Minimal effort is the reasoner default.
- Demo-sized call (855 input tokens, proposal schema), three runs:
  8985 ms / 8292 ms / 7226 ms — median **8292 ms** against a 4000 ms demo
  budget. It does not fit; live beats are pre-warmed and labeled as such.
- Re-probe 2026-11-02 (prompt card.v3, 1015 input tokens): 13061 / 14038 /
  20638 ms, median 14038 ms — still outside budget. Reasoning-parameter
  pattern unchanged (flat `reasoning_effort` accepted, nested rejected). A
  second v3 run the same day metered 11264 / 10816 / 14166 ms (median
  11264 ms) — run-to-run variance, same verdict.

## Localizer — `sam-3.1`

- Transport: `POST {base}/responses`, one noun phrase per call. Masks arrive
  in the SAM 3 grammar and parse to half-open pixel boxes; mask payloads are
  kept opaque (raster decode not implemented).
- Billed fixture: PNG creative, 2160×2700
  (sha256 `d38d0d62…e466e2`), five phrases
  (`payment handle`, `QR code`, `contact button`, `brand logo`,
  `price or offer amount`).
- Yield: **1 region of 5** — `brand logo`, score 0.77, 70×74 px box in pixel
  coordinates, in-bounds of the reported dimensions. Crop round-trip passed.
- Vectors rejected: the identical request shape against an SVG creative (W7
  creative-1, 1024×1024, sent as `image/svg+xml`) returns HTTP 400
  (2026-11-02). The endpoint localizes raster only — and since the pipeline
  reads text only from vectors, the live end-to-end mask→handle→card chain is
  unmeasurable with this endpoint: boxes are measured live on raster,
  extraction is measured offline on vectors, and no run claims otherwise.
- Handle-text attempt: a PNG screenshot of the same creative (1018×1017,
  baked handle text in the corner) returned an empty lane across all five
  phrases (2026-11-02) — a valid no-match response, not a failure. Live
  handle-region yield stands at zero measured, over two fixtures and ten
  phrase-calls with one logo box total.
- Not yet measured: end-to-end live localization → text extraction → card.
  The billed probe localized a logo on a raster fixture (boxes only, no text
  to extract); SVG text extraction is covered by offline tests (P9), not by a
  billed call.

## Cost

A demo-sized reasoner call metered from recorded tokens at contributor rates
($0.10 / $0.20 per Mtok) costs a fraction of a cent; the live two-card run
metered $0.0006. Cost is not a design constraint; latency is.
