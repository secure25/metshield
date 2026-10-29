# AGENTS.md — MetShield constitution

You are building MetShield, a scam-protection layer for Facebook, Messenger and
WhatsApp: observations in, correlation, model reasoning, validation, a card out.
Read this before every change. Repo root is `metshield/` (one package, one port).

## Layout (do not reshape without asking)

- `src/contract.ts` — the `Observation` type, the only thing product and world share.
- `src/world/**` — the Living World fixture. Product code never imports from it.
- `src/**` (minus `world/`, `console/`) — MetShield the product.
- `src/connectors/world.ts` — the one file on the product side that reads the
  world, over HTTP only (`GET /api/world/observations`). Nothing is written back.
- `src/console/` + `src/server.ts` — hosts that serve both sides.

## Non-negotiable

1. **Boundary.** Product code never imports from `src/world/**`. The only
   contact is `src/connectors/world.ts` reading the world's HTTP feed. With
   `src/world` removed, the product still typechecks, still starts, still
   serves `/v1/*`, and still handles an observation from another source. A test
   asserts this; it is not negotiable.
2. **No message content, ever.** `Observation` carries `raw?: never`. Do not
   add a field that carries conversation text, and never store or send private
   message text or personal data — including to a model.
3. **Meta models only.** Muse Spark 1.3 and SAM 3.1 over one OpenAI-compatible
   base URL, or Muse Spark Open on an approved inference partner if that URL is
   unavailable. Never add another provider's model — not for a fallback, not
   for a test.
4. **The model proposes; `src/validate.ts` disposes.** Never render model output
   that has not passed the validator. Never let the model choose a tier without
   the demotion checks.
5. **Closed vocabularies.** World narrative kinds live in `src/contract.ts`;
   structural families live in the product normaliser. Unknown indicator types
   are rejected with a reason code, never passed through.
6. **Silence is a valid, expected result** and must be logged with a reason
   code. Do not add a code path that always warns.
7. **Real feeds stay clean.** Public connectors consume URLs and domains only:
   no page bodies, no DNS resolution, no personal data of any kind.
8. **No new runtime dependency** without one line of justification. No database,
   no ORM, no queue, no auth, no Docker. JSONL logs and a Map.
9. **Every feature ships with a test that fails without it.** Run `npm test`
   and `npm run check` in the package root before reporting done, and paste the
   tail of both. Never report success you did not observe.
10. **Ambiguity → smallest version.** Implement the least that passes, list what
    you left out. Decide reversible details yourself; ask about anything that
    changes the contract, the phase order, or what gets deleted.

## How we work

Phases arrive one per message, in order, and each is finished only when its
acceptance command has been run and its real output pasted — not when it
compiles. Every phase builds on the ones before; nothing is rewritten to make
a later phase easier, and anything that must change is stated with reasons
first. Each phase ends with a commit whose message names the phase.

## Style

TypeScript strict, no `any`, explicit return types on exported functions.
Errors are values with codes, not thrown strings. Log lines are one per
event, JSON, with a stable `event` key. Seeded randomness and simulated
time in world logic — never ambient randomness or wall-clock time there.
