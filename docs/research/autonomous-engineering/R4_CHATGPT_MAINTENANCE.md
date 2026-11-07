# R4 — ChatGPT as a *context-aware* maintainer of a source-bound generated app

**Author:** ChatGPT GPT-6 in the same ongoing ProtocolIA development conversation, not a fresh model and **not** a blind/historically isolated maintainer. This is a separate, independently checkable **software engineering implementation**, deliberately distinct from the Qwen3 experiment in PR #178. Do not mix these two evidence classes.

## Owner request received

The user requested that ChatGPT itself act as the ProtocolIA maintainer rather than only arranging tests for another agent. The fixed public change request in `tests/research/fixtures/r4-cold-handoff/CHANGE_REQUEST.md` authorizes exactly one new optional, nullable UTC date-time field, `Tool.calibrationDueAt`, with matching `ToolRequest`. It authorizes **no new routes, permissions, scheduler, due-date policy or automatic restriction**.

## Actual deliverable

The exact assistant-authored candidate and response are committed (not synthesized by a CI reference fixture):

- `experiments/r4-chatgpt-maintainer/submission/contracts/main.tsp`: full TypeSpec replacement. Adds `calibrationDueAt?: utcDateTime | null` to `Tool` and `ToolRequest`, nothing else.
- `experiments/r4-chatgpt-maintainer/submission/tspconfig.yaml`: unchanged pinned compiler/emitter configuration.
- `experiments/r4-chatgpt-maintainer/submission/handoff-response.json`: original canonical contract hash, two specific unanswered business questions (calibration frequency and overdue response), explicit refusal to invent a new authorization or background workflow.

**Do not** reuse this published solution as a secret benchmark exemplar. Its provenance is intentionally visible and it comes from the same conversational context that shaped the challenge, so it cannot establish independent rehydration capability.

## Strict evidence to demand before claiming this change works

The workflow `.github/workflows/r4-agent-authored-calibration.yml` compares the exact committed candidate against a newly generated source-bound Passport and the out-of-bundle CI oracle with `scripts/research/r4-handoff-benchmark.mjs score`.

Then, **for both NestJS and modular Spring, on separate disposable GitHub runners**, it reuses the R4.2 verified PostgreSQL drill:

1. Generate and start the unmodified old app against fresh disposable PostgreSQL; use HTTP to create two tools, check manager/reader authorization and uniqueness, then snapshot exact rows and DB container identity.
2. Take a `pg_dump` custom-format checkpoint from the old running Compose project; verify its checksum, source contract binding, secure mode and overwrite refusal. Require a tampered copy to be rejected.
3. Rehydrate the old embedded TypeSpec and check its lock. Replace **only** the editable source contracts with the exact committed assistant candidate, and keep the original toolchain config unchanged.
4. Run `db:preflight` to restore the checkpoint in an isolated `--network none` PostgreSQL and rehearse the exact additive SQL while checking old-column row SHA digests. The old DB must remain unchanged.
5. Present a forged SQL approval report and require `evolve:verified` to reject it, then present the real report and require a successful code regeneration with preserved source-bound Passport.
6. Recreate only the app container, retaining the old original database container and volume. Require the old records to remain, a newly created `calibrationDueAt` to round-trip in HTTP and PostgreSQL, existing atomic quantity increment, 403 reader write refusal, 409 duplicate, and persistence across app restart.
7. Restore the **old pre-upgrade** archive on a second, network-disabled PostgreSQL volume. Require original rows and old schema, force-kill the restored container, restart it, and verify WAL recovery and complete isolation from the evolved original database.

The CI may have all tests green and still **does not certify an independent clean-room agent**: one benchmark task and same-chat knowledge contaminate that inference. It also does not assert owner-authorized calibration schedules, real live recovery RPO/RTO, or any production upgrade. Keep issue #106 open for actual fresh-agent trials, a second unfamiliar domain and real authenticated policy authorization.

## Engineering boundaries

We parameterized `scripts/research/r4-verified-checkpoint-restore.mjs` with an optional `--submission` path. Omitting that argument preserves the original R4.2 scripted `serviceNote` regression, so existing CI guards cannot silently be weakened. Two new HTTP exercise modes are specific to the new optional calibration field; the original seed, verify and persist paths still exist unchanged. The assessor and runtime tests are based on committed candidate bytes; CI does **not** manufacture a solution.

No production cutover, external service model charge, GitHub deployment, or merge of PR #178 is part of this change.
