# R4.3 — fresh offline model on a clean-room handoff: experimental acceptance

**Status:** a real *local* bounded tool-using model trial. Do not equate the tool runner's completion with correctness: the submitted contract must pass a separate semantic oracle and real two-target builds. No independent multi-year, production rollback or business approval is implied.

## Important provider correction

An initial attempt on PR #178 used `https://models.github.ai/inference/chat/completions`; the provider returned HTTP 200 with plain text `OK`, not inference JSON. GitHub's [current documentation](https://docs.github.com/en/github-models) explicitly states **GitHub Models was fully retired July 30, 2026**. This was a provider-integration mistake, not failure by an executing model. **Do not resume or advertise that endpoint.** Railway Cloud Agents/Automations are also unavailable in the connected Railway account.

The replacement runs a fully local model in the isolated GitHub Actions job via **Ollama**. The intentionally small, reproducible baseline is `qwen3:4b-instruct-2507-q4_K_M` (approximately 2.5 GB, quantized) in CPU mode. Its tool and coding ability is significantly below larger commercial models. This is a valid **distinct model invocation**, not a guarantee of competence. The runner uses Ollama's `POST /api/chat` with `stream:false`, bounded context (`num_ctx=12288`, `num_predict=2400`), no cloud inference token and a maximum of ten turns. **The transport uses Node's built-in `node:http`** with a 720-second per-request AbortSignal and 1 MiB response bound: unlike global `fetch` (Undici), this does not inherit a hidden 300-second HTTP response-headers timeout. It records per-round timings, retries only a transport failure while localhost Ollama remains healthy, logs the underlying error cause, and retains the existing tool/output limits. No response is synthesized when the model fails.

## Job-level boundaries and experimental method

The `r4-independent-model-trial.yml` workflow separates three jobs:

1. **prepare** has repository read access: build original Taller TypeSpec with Project Passport, verify and upload an integrity-locked 20-file `r4-live-participant-only` artifact. A separate runner-script artifact is uploaded for execution, never added to the participant bundle.
2. **independent-model** starts with **no checkout**; `contents:none`, `actions:read` only. It downloads the immutable participant bundle and runner script, installs Ollama on the ephemeral runner, and pulls `qwen3:4b-instruct-2507-q4_K_M`. It makes local HTTP inference calls. The model's tool surface is restricted to `read_file` for names in the original bundle, `write_candidate` for two output files, `check_candidate` for static formatting/diff hints, and `finish`. It has no arbitrary shell, Internet, Github API, original chat, or oracle tool. It writes metadata about model identity, rounds, token counts and tool names; never keys or full hidden scoring inputs.
3. **assessor** has repo read access only after the model finishes. It consumes the actual candidate and provenance artifact, runs the separately controlled existing `r4-handoff-benchmark.mjs` against a CI oracle unavailable to the participant model, and builds the model's actual TypeSpec into NestJS **and** modular Spring. **For each target, it also builds a fresh old application and performs an actual PostgreSQL `pg_dump` checkpoint, `db:preflight`, `evolve:verified` with the exact model candidate, HTTP and SQL data-preservation checks, separate `--network none` old-schema restore and forced database restart.** The assessor will fail if the submitted unknown-policy report does not pass the unchanged oracle; a build-only pass is insufficient.

The test uses a fixed, preregistered change request involving `Tool.calibrationDueAt`, optional UTC date-time on both entity and create-request model. Unresolved questions about calibration cadence and expired calibrations must remain explicitly unapproved rather than producing imaginary background jobs or capabilities.

The CI oracle is present **in this repository** and excluded from the participant artifact. This is an interface-isolated test, not a secret test from an actor with unrestricted repository read permissions. Token-counters from Ollama may be zero or approximate if backend metadata is unavailable; do not inflate measured costs. The model is running on an ephemeral Actions CPU runner, never on an external customer's or local developer computer.

## Necessary conditions to claim this trial succeeded

- [ ] A GitHub Actions run containing a completed, non-synthetic `independent-model` job
- [ ] The actual model reads the provided participant files and writes TypeSpec plus its provenance/unknowns report, with recorded tool names and bounded turns
- [ ] The assessor verifies the candidate's original handoff SHA, preserved capability/operation invariants, optional new entity and request fields, and natural-language policy abstentions
- [ ] The assessor actually builds both generated applications and verifies their ownership seals
- [ ] For each target, the **model's actual bytes** pass a new populated-PostgreSQL backup, network-isolated SQL preflight, verified evolution, HTTP/SQL preservation and old-schema crash recovery
- [ ] The exact commit's quality, Passport, R4 PostgreSQL and R1 regressions all pass

Do not mark the requirement complete if `independent-model` fails to finish. A **failed model candidate is scientifically useful** if its failure is correctly captured and independently scored. Do not switch to the earlier deterministic CI reference, modify test oracle to rescue a model output, or fabricate a model response.

## Still not proven

Even a successful run only proves a bounded tool-enabled retake on an existing small inventory contract with an intentionally narrow, published business change. It does not prove a blind unfamiliar multi-entity application, a future maintainer's competence after two real calendar years, production-grade database migration of **this exact model's** output, general performance across models/harnesses or human-signed policy decisions. The next meaningful test **after an accepted baseline** is a second unfamiliar domain and an externally permissioned evaluator; this workflow now runs loaded PostgreSQL/HTTP checks on the actual returned candidate, but has not yet proved them successful for a fresh model. Keep issue #106 OPEN until broader R4 closure criteria have verified evidence.

## Restarted trial after PR #179 merged: infrastructure/transport distinction

The original PR #178 on an older base is not mergeable after [#179](https://github.com/barbasmarcosi/ProtocolIA/pull/179) landed its independent, context-aware ChatGPT-authored PostgreSQL drill. The refreshed trial is deliberately rebased from that `main` commit; it uses the new `--submission` path **without importing the human-authored sample candidate** into the model's participant bundle. The old sample remains public elsewhere in the repository; the fresh model job has neither checkout nor repository tool access. This is **interface isolation**, not proof against model pretraining contamination or arbitrary unrestricted external resources.

One Qwen3 v2 run on [PR #178 / run #42308924940](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/42308924940) failed with a local `fetch failed` after roughly 7.5 minutes and did not produce an assessable candidate. There was no semantic failure evidence from that run. The refreshed runner makes the Ollama communication error more diagnostic, reduces CPU decode/context budgets, and permits one bounded retry only if the local inference endpoint is still healthy. Do not rewrite either the original v1 policy-understanding failure or the v2 transport failure as an accepted agent result.

A one-off archived negative replay in PR #178 referenced GitHub Actions artifacts expiring after 14 days; it is not carried into the permanent main-branch CI. The historical run links remain as non-permanent raw evidence. True durable experiment archiving should use content-addressed, retention-managed storage with access controls.

## Second measured transport defect (2026-11-06)

The new [isolated model run #42328139428](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/42328139428) supplied a conclusive transport diagnosis. The model completed **three genuine tool-using rounds** (eight source reads in the first, and one in each of rounds 2 and 3). Its fourth round waited **300,741 ms** and then failed with `Headers Timeout Error` from Undici. A retry while Ollama was still healthy again failed after **300 seconds**. Therefore this was a **client HTTP timeout**, not evidence the TypeSpec task was too hard for the model. The assessor did not run and no positive model result exists for that attempt.

The native `http.request` replacement removes the implicit Undici timeout while preserving the explicit 720-second bound and bounded single retry. A subsequent fresh-model run must be evaluated as a **new attempt**; it cannot be declared successful by modifying the earlier run or reusing the known deterministic reference solution. Its exact artifacts and adapter/database evidence must be recorded independently.
