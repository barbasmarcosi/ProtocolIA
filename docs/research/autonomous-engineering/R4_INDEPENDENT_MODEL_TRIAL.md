# R4.3 — fresh offline model on a clean-room handoff: experimental acceptance

**Status:** a real *local* bounded tool-using model trial. Do not equate the tool runner's completion with correctness: the submitted contract must pass a separate semantic oracle and real two-target builds. No independent multi-year, production rollback or business approval is implied.

## Important provider correction

An initial attempt on PR #178 used `https://models.github.ai/inference/chat/completions`; the provider returned HTTP 200 with plain text `OK`, not inference JSON. GitHub's [current documentation](https://docs.github.com/en/github-models) explicitly states **GitHub Models was fully retired July 30, 2026**. This was a provider-integration mistake, not failure by an executing model. **Do not resume or advertise that endpoint.** Railway Cloud Agents/Automations are also unavailable in the connected Railway account.

The replacement runs a fully local model in the isolated GitHub Actions job via **Ollama**. The intentionally small, reproducible baseline is `qwen3:4b-instruct-2507-q4_K_M` (approximately 2.5 GB, quantized) in CPU mode. Its tool and coding ability is significantly below larger commercial models. This is a valid **distinct model invocation**, not a guarantee of competence. The runner uses Ollama's `POST /api/chat` with `stream:false`, bounded context, no cloud inference token and a maximum of ten turns.

## Job-level boundaries and experimental method

The `r4-independent-model-trial.yml` workflow separates three jobs:

1. **prepare** has repository read access: build original Taller TypeSpec with Project Passport, verify and upload an integrity-locked 20-file `r4-live-participant-only` artifact. A separate runner-script artifact is uploaded for execution, never added to the participant bundle.
2. **independent-model** starts with **no checkout**; `contents:none`, `actions:read` only. It downloads the immutable participant bundle and runner script, installs Ollama on the ephemeral runner, and pulls `qwen3:4b-instruct-2507-q4_K_M`. It makes local HTTP inference calls. The model's tool surface is restricted to `read_file` for names in the original bundle, `write_candidate` for two output files, `check_candidate` for static formatting/diff hints, and `finish`. It has no arbitrary shell, Internet, Github API, original chat, or oracle tool. It writes metadata about model identity, rounds, token counts and tool names; never keys or full hidden scoring inputs.
3. **assessor** has repo read access only after the model finishes. It consumes the real candidate and provenance artifact, runs the separately controlled existing `r4-handoff-benchmark.mjs` against a CI oracle unavailable to the participant model, and builds the model's actual TypeSpec into NestJS **and** modular Spring. It verifies the generated Passport seal and specific canonical IR invariants.

The test uses a fixed, preregistered change request involving `Tool.calibrationDueAt`, optional UTC date-time on both entity and create-request model. Unresolved questions about calibration cadence and expired calibrations must remain explicitly unapproved rather than producing imaginary background jobs or capabilities.

The CI oracle is present **in this repository** and excluded from the participant artifact. This is an interface-isolated test, not a secret test from an actor with unrestricted repository read permissions. Token-counters from Ollama may be zero or approximate if backend metadata is unavailable; do not inflate measured costs. The model is running on an ephemeral Actions CPU runner, never on an external customer's or local developer computer.

## Necessary conditions to claim this trial succeeded

- [ ] A GitHub Actions run containing a completed, non-synthetic `independent-model` job
- [ ] The actual model reads the provided participant files and writes TypeSpec plus its provenance/unknowns report, with recorded tool names and bounded turns
- [ ] The assessor verifies the candidate's original handoff SHA, preserved capability/operation invariants, optional new entity and request fields, and natural-language policy abstentions
- [ ] The assessor actually builds both generated applications and verifies their ownership seals
- [ ] The exact commit's quality, Passport, R4 PostgreSQL and R1 regressions all pass

Do not mark the requirement complete if `independent-model` fails to finish. A **failed model candidate is scientifically useful** if its failure is correctly captured and independently scored. Do not switch to the earlier deterministic CI reference, modify test oracle to rescue a model output, or fabricate a model response.

## Still not proven

Even a successful run only proves a bounded tool-enabled retake on an existing small inventory contract with an intentionally narrow, published business change. It does not prove a blind unfamiliar multi-entity application, a future maintainer's competence after two real calendar years, production-grade database migration of **this exact model's** output, general performance across models/harnesses or human-signed policy decisions. The next meaningful test is a second domain, a privileged independent evaluator, and loaded PostgreSQL/HTTP checks on the actual returned candidate. Keep issue #106 OPEN until broader R4 closure criteria have verified evidence.
