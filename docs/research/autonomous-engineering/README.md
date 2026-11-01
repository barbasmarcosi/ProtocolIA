# R1 — Autonomous engineering and durable project knowledge (research, 2026-11-01)

**Status: PROPOSED / EXPERIMENTAL. No new production claims.** This research track does not change the vNext contract compiler, TypeSpec/IR semantics, financial acceptance gates, existing release tags or generated deployment logic.

## Product intent (supersedes earlier commercial-first framing for this track)

ProtocolIA is primarily a **personal software factory**: given domain requirements, produce a nearly complete **working application within explicit supported capabilities**, independently checked and intelligible to the owner or a new agent years later. Reviewing/editing TypeSpec and requirements must remain possible, but routine development must be able to proceed autonomously.

An AI may investigate and propose requirements, contracts and explanations. **It may not claim an unspecified business policy was supplied by the owner, treat assumed security permission as approval, or silently claim an unsupported behavior works.** Unsupported work is visible in an acceptance ledger.

## Non-negotiable boundaries

1. **One semantic source of truth:** the existing TypeSpec + ProtocolIA IR remain authoritative for executable behavior. External Markdown proposals explain intent, rationale and changes; they do not override compiler semantics. Reconcile discrepancies before generating.
2. **Autonomous, reviewable workflow:** default decisions about reversible technical choices can be made with recorded rationale. Material business ambiguities, privilege increases, external side effects, money or destructive migrations require explicit previously authorized policy; otherwise block/isolate the affected feature. Draft contracts remain manually editable.
3. **No fictitious competence:** a successful generated build is not a finished usable application, self-reported tests are not independent verification, green CI is not production approval, and documentation is not a substitute for source/runtime conformance.
4. **Project rehydration:** a fresh engineer/agent without original chat transcripts should locate domain decisions, contracts, architecture, generated/extensible code, migrations, tests, run/deploy instructions and unresolved assumptions.
5. **Provider independence:** no vendor-specific agent format as canonical product data; adapters can invoke external agent harnesses under pinned permissions/versions.
6. **No unapproved operations:** R1 evaluation is read-only and offline. No installs, provider calls, generated deployment, payment processing, authorization changes or migration of real data.

## Scope / sequencing

- **R1 (this branch):** source-backed candidate inventory; preregistered three-case trial; minimal deterministic evidence/decision gate + tests; evaluation record format and CI. No framework selected by popularity.
- **R2:** prove autonomous requirement-to-contract production on the same cases with pinned agents and the existing TypeSpec compiler. Keep manual editing and fail-closed material ambiguities. Independent grammar/semantic validation is mandatory.
- **R3:** create a self-contained Project Passport from canonical IR, compiled app manifest, explicit ADRs and tests; generate diagrams and documentation **with provenance**. Never infer intent from file names. Distinguish `derived`, `user-confirmed` and `hypothesis`.
- **R4:** two-year-handoff acceptance: new session with no chat history interprets, rebuilds, changes, migrates and explains a generated app, without breaking invariants.

A proposed architecture is in [ADR-001](ADR-001-AUTONOMY-KNOWLEDGE.md), tool tradeoffs in [TOOLS_20261101](TOOLS_20261101.md), and the experimental protocol in [ACCEPTANCE](ACCEPTANCE.md).

## Local R1 gate (Node 22+; no dependencies)

```sh
node --test tests/research/autonomy-r1.test.mjs
node scripts/research/autonomy-r1.mjs check research/autonomous-engineering/cases/kiosk.json
node scripts/research/autonomy-r1.mjs check research/autonomous-engineering/cases/workshop.json
node scripts/research/autonomy-r1.mjs check research/autonomous-engineering/cases/rehydration.json
node scripts/research/autonomy-r1.mjs audit research/autonomous-engineering/cases/kiosk.json research/autonomous-engineering/samples/kiosk-autonomous-intake.json
# expected exit code: 2 (deliberately blocked assumptions)
```

The `audit` command checks recorded decisions against the bounded policy; it does **not** call an AI, produce TypeSpec, attest that an evidence URL is genuine or evaluate a candidate tool. Those capabilities belong to later empirical stages.

## Relations to existing work

- Preserve [vNext requirements](../../vnext/00_PRODUCT_REQUIREMENTS.md) and [architecture](../../vnext/01_ARCHITECTURE_ADR.md) unless a separately reviewed ADR explicitly updates normative docs.
- Reuse real generated Spring/Nest and PostgreSQL/Chromium acceptance, not a synthetic pass.
- The historical P4 agent economics benchmark is separate: its documented preflight recorded **0 genuine agent runs**, so no cost/speed win is implied by R1.
- The ongoing financial TL-14 track is independent and remains open until its own real external evidence exists.
