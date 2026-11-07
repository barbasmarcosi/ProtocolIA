# R4 forensic replay — genuine Qwen3 TypeSpec, incomplete handoff, technical verification only

**Evidence type: retrospective exact-byte replay, NOT successful independent-agent submission.**

A fresh, repository-free Qwen3 session from [GitHub Actions run #42329470874](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/42329470874) genuinely read the participant's source-bound Passport, wrote replacement TypeSpec, wrote a source-bound `handoff-response.json`, and called the participant-facing `check_candidate` tool. It **did not call `finish`**, despite multiple follow-up prompts, within ten bounded rounds. The original model job therefore ended **FAILED** and the separate assessor was skipped. This record must never be relabeled a successful clean-room handoff.

## What we preserved

The original four-file, unmodified `r4-live-model-response` ZIP (GitHub artifact **13557256844**) was downloaded with the GitHub connector and frozen as text under `experiments/r4-frozen-qwen-20261107/model-artifact.zip.base64`. Its independently computed SHA-256 is:

`4bfb0c9517df055752d71b9f89d4078996c80d411256249df9e413a3e5affb55`

The locked provenance record specifies the source run, artifact ID, source contract SHA, model, missing `finish` call, ten rounds and token usage. The ZIP contains **only** the original `candidate/contracts/main.tsp`, `candidate/tspconfig.yaml`, `candidate/handoff-response.json` and `trial-metadata.json`. The replay verifies the exact SHA-256 and allowed entry names before extracting. It will refuse any additional or unexpected file. No CI fixture or candidate file is edited after extraction.

The genuine Qwen candidate adds `calibrationDueAt?: utcDateTime | null` to both entity and request model without altering operation capabilities. It asks (in English) about tool-specific calibration intervals and what to do when the due date is **exceeded**. The latter question expresses the missing overdue rule but does not contain any of the scorer's fixed substrings (e.g. `overdue`, `expired`); consequently, the existing `r4-handoff-benchmark score` returns a **negative result**. This is a demonstrable *lexical blind spot* in the scorer, **not proof of owner-approved policy or a full semantic-pass certificate**.

Changing the held-out oracle after reading this answer would introduce hindsight leakage. Therefore the frozen replay **expects** that exact negative result and refuses to silently reinterpret it as an accepted blind trial. The unanswered policy remains unanswered.

## Genuine technical verification, separate from full acceptance

The [`r4-qwen-forensic-replay.yml`](../../.github/workflows/r4-qwen-forensic-replay.yml) CI performs a two-target matrix with disposable generated **NestJS** and **modular Spring** apps on real PostgreSQL. For each:

1. Reconstruct the unchanged original app with a source-bound Passport.
2. Verify the precise original ZIP SHA-256, exact filename list, model metadata, visible tool calls, and **absence of a `finish` call**.
3. Recreate the original 20-file participant handoff and require the historical lexical scorer to reject the original text exactly as recorded, without altering it.
4. Feed **only the genuine model-authored TypeSpec** to `r4-verified-checkpoint-restore.mjs --submission`. The script takes a custom-format `pg_dump` from a populated old database, verifies its seal, rehearses the precise additive migration on a network-disabled PostgreSQL, tests forged-report refusal, runs `evolve:verified`, preserves old records and original DB identity, checks real HTTP authorization/duplicate/stock behavior and persisted calibration timestamp, and restores an unchanged old-schema checkpoint into a separate network-disabled volume followed by a forced crash/restart.

When green, this may support the narrow statement: **the failed-to-finish Qwen model nonetheless authored TypeSpec that safely evolved a disposable PostgreSQL application for both targets**. It cannot prove the agent closed a handoff, that the business oracle approved its answer, or that it could maintain an unfamiliar system after years.

The original negative run will remain negative. Do not use this frozen model-produced solution as an unseen benchmark answer for later agents. Future tests need fresh, unavailable-to-participant oracles with independent semantic adjudication, better completion-state handling and a second unfamiliar domain. Issue #106 stays open; no production deployment or real owner decision is implied.

## Source conservation rationale

An ephemeral GitHub Actions artifact expires. Recording the archive as integrity-checked base64 keeps the **same original candidate bytes** permanently reproducible by CI without fabricating a passing model output, relying on soon-expired downloads or calling Qwen repeatedly to regenerate it.
