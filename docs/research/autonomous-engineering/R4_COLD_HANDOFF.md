# R4.3 — Cold handoff benchmark: isolated participant package and out-of-band oracle

**Status:** reproducible benchmark infrastructure and deterministic controls only. It is **not** evidence that a separately initialized agent completed this task. Issue #106 remains open until a real agent run is audited.

## Why a different gate is needed

R4.0–R4.2 demonstrated that original TypeSpec can be recovered from a generated application's Passport, compiled again, evolved with checked SQL, and its populated PostgreSQL data restored into an isolated database. The previous tests were deliberately scripted by the same engineers who knew the intended answer. That does not measure whether an unfamiliar future agent can understand a business domain and avoid hallucinating policy.

A genuine handoff demands two explicit trust boundaries:

1. **Participant surface:** sealed source contract, generated domain evidence, the approved user change request, and participant instructions. No scoring oracle, acceptance tests, model answer, original conversation or unrelated repository files may be mounted in the participant's environment.
2. **Evaluator surface:** a separately controlled oracle, the candidate's submitted TypeSpec and unknown/abstention report, and a pinned compiler. The assessor must verify behavior independently and record the exact agent session/model/input access. The evaluator cannot itself attest that the candidate was produced by an independent agent.

## Implemented protocol

The source-backed portable packaging command is:

```sh
node scripts/research/r4-handoff-benchmark.mjs package \
  /path/to/source-bound-generated-app \
  tests/research/fixtures/r4-cold-handoff/CHANGE_REQUEST.md \
  /path/to/new-participant-package

node scripts/research/r4-handoff-benchmark.mjs verify \
  /path/to/new-participant-package
```

The command first verifies the generated application ownership seal, its original TypeSpec snapshot against its original pre-build SHA-256, and that an opt-in Passport exists. It copies **only** TypeSpec sources, source integrity metadata, canonical IR/OpenAPI, build metadata, Passport docs, `PROJECT_HANDOFF.md`, `AGENT_TASK.md`, and `CHANGE_REQUEST.md`. It emits a separate `HANDOFF.lock.json` mapping exact relative paths to SHA-256 hashes. It fails closed on symlinks, unreviewed paths, content changes, missing files, inappropriate source layout and size limits. The hash is **not** a signature or owner approval.

The agent submits in another directory:

```text
submission/
  contracts/main.tsp
  tspconfig.yaml
  handoff-response.json
```

The participant-facing instructions define the JSON schema. The evaluator is executed only by the **assessor**, with an oracle path withheld from the participant environment:

```sh
node scripts/research/r4-handoff-benchmark.mjs score \
  /sealed/participant-package \
  /isolated/submission \
  /assessor-only/held-out-oracle.json
```

The scorer checks exact original file set and unchanged toolchain configuration, the submission's original contract SHA-256 binding to the delivered handoff, schema validity and compilation with the pinned TypeSpec toolchain, the canonical Contract IR diff via the existing evolution verifier, OpenAPI compatibility, and preservation of all existing operations/capabilities. The fixture demands an authorized single optional/nullable field plus two **distinct natural-language questions** about unresolved material policies (rather than just copying hardcoded answer labels). The test oracle uses bounded concept terms, not an LLM grader. It refuses executable/undeclared payloads, extra business capabilities, missing material questions and overbroad schema changes. This **does not** substitute for full SQL/browser/HTTP evaluation; subsequent scoring should reuse the R4.2 backed-up disposable database when a real agent artifact becomes available.

## Evidence gate in GitHub Actions

[Workflow `r4-cold-handoff.yml`](../../.github/workflows/r4-cold-handoff.yml) builds a real original NestJS app, creates and verifies the participant bundle, and uploads only that bundle as `r4-cold-participant-bundle` (retention 14 days).

It then runs a **deterministic local reference control**, deliberately not a remote agent, and scores it against a CI fixture oracle kept outside the participant artifact. Six negative candidate submissions must fail: modified capability, omitted natural-language material question, undeclared executable file, failure to make the requested change, a response claiming the wrong handoff source hash, and a field added only to the persistent entity but missing from the create-request DTO. The scorer checks that the new field appears as optional in both the entity and request OpenAPI component schemas. A modified participant package must also be rejected. Finally, the reference candidate is compiled into both real generated targets, NestJS and modular Spring, with a verified refreshed Passport and unchanged operation catalog.

**Important: the CI oracle is committed under `tests/research/fixtures/r4-cold-handoff/ci-control-oracle.json` for transparent regression tests. It is not contained in the uploaded artifact, but it is NOT secret from someone with repository read access.** Therefore the present gate certifies only package boundaries and scorer correctness **under limited distribution**, not a legitimately hidden challenge against an agent with unrestricted repository access. A production-quality blind trial requires a separately permissioned private oracle/repository or an external evaluator service, and a clean agent workspace with only the distributed bundle and a pinned toolchain.

## Minimum acceptance for an actual R4.3 independent agent run

The following must all be observed and recorded, never inferred from a passing control script:

- A previously unused agent session and input ACL that excludes this chat, repository history, evaluator code, oracle files and any prior answer.
- The exact delivered `HANDOFF.lock.json`, task wording, approved business rules, and separately retained oracle checksum before the agent starts.
- The agent's editable TypeSpec, its material unanswered questions/abstentions, and captured tool interaction and model identifiers. Real token/cost/latency records when the provider exposes them.
- An evaluator that independently builds both app targets and exercises authorized/new behavior and negative authority tests; a disposable populated PostgreSQL checkpoint + verified evolution + isolated recovery, with exact old rows preserved.
- A reviewer who did not produce the submission examines ambiguous policies before any scope expansion. Repeating the trial with a distinct domain and another model/harness should follow before drawing general product conclusions.

No production deployment, paid remote model run, privileged repo mutation or agent was invoked as part of this benchmark infrastructure. Do not mark R4 complete when only the deterministic control has passed.
