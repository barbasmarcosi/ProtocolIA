# ProtocolIA

**Contracts before code. Evidence before claims. Intelligence only where it is needed.**

ProtocolIA is a provider-independent research and engineering project for compiling typed software contracts into deterministic artifacts, and into narrowly constrained, auditable local action plans (v0.4). A separate experimental read-only Docker tool is supported only via a trusted host; arbitrary privileged/external agent tools remain unsupported. It is **not** a general-purpose programming language, a replacement for LLMs, or an autonomous coding agent.

## Current product direction — ProtocolIA vNext (2026-10-13)

**Goal:** from reviewed business requirements and **TypeSpec contracts**,
generate a **working complete system**: persisted backend, operations with
real domain semantics, security, navigable React UI, tests and deployable
container, with no per-resource handwritten application implementation.

**Architecture (planned, not implemented):** `@protocolia/domain` TypeSpec
library → technology-neutral semantic IR → replaceable generation adapters.
**A0 candidate:** JHipster 9.4 + React + Spring Boot + PostgreSQL, with a
JHipster NestJS target second; no JDL-first contract, no TypeSpec grammar
claimed implemented. If JHipster distorts contract identity, HTTP semantics
or regeneration, a modular adapter based on OpenAPI Generator/frameworks
is the documented fallback.

**Source of truth for vNext:**
- [Product requirements](docs/vnext/00_PRODUCT_REQUIREMENTS.md)
- [Architecture / ADR-004](docs/vnext/01_ARCHITECTURE_ADR.md)
- [A0–A5 implementation plan](docs/vnext/02_IMPLEMENTATION_PLAN.md)
- [Real behavior acceptance matrix](docs/vnext/03_ACCEPTANCE_MATRIX.md)
- [Execution runbook / next task](docs/vnext/04_EXECUTION_RUNBOOK.md)

**Status:** A0–A5 **NOT STARTED**. Current v0.1–v0.4 generators
and G5 pilot remain usable/historical. They do not already generate
complete general applications. The workshop experiment remains a
functioning **hand-integrated** full-stack demo, not A1/A2 evidence.

## Start a Java/Spring project from a contract

With Python 3.11+ and a checked-out copy of ProtocolIA:

```sh
python -m pip install .
protocolia init-java examples/catalog-vertical/contract.json --out my-service
cd my-service
mvn -B -ntp clean verify
```

The command generates **one runnable Spring Boot 4 / Java 21 module**, with
typed API records, an MVC controller, validation, a demo-only authentication
configuration and a **user-owned** `src/main/java/dev/protocolia/generated/custom/StarterHandlers.java`.
Edit that file to implement your domain rules. Until then, authenticated business
requests intentionally return HTTP **501**, not a fake success. To start the
service, configure `PROTOCOLIA_USER`, `PROTOCOLIA_PASSWORD` (16+ characters) and
`PROTOCOLIA_SCOPES` for your contract before running
`mvn spring-boot:run` (local demonstration only; never commit credentials).

After changing the contract, rerun **the same** `init-java` command with the
same output path. ProtocolIA regenerates *owned* files but never overwrites
your `StarterHandlers.java`. If method signatures change, fix that service
yourself; Maven compilation will report the missing implementations. For an
already-implemented tutorial, see [catalog vertical example](examples/catalog-vertical/README.md).
A previous `java-spring/0.3` directory must be migrated explicitly into a new output
directory rather than silently overwritten.

## G5 — verified bounded full-stack pilot

G0–G5 are implemented and verified for a bounded, nonproduction Books slice.
[The exact-source G5 closeout](docs/G5_CONTRACT_EVOLUTION_PROGRESS.md)
records **221 Python tests (one skipped)**, **11 PostgreSQL/JUnit**, **8 signed
JWT/PostgreSQL JUnit**, **5 real Chromium Playwright**, two-JVM data durability,
two-pass deterministic code generation, plus an independently generated Widgets
resource. No paid LLM provider or GitHub Actions minutes were used.

Try the [versioned Books example](examples/books-evolution-v04/README.md),
including `publishedAt` optional-nullable and the `renameBook` operation.
Use the dedicated `examples/books-web-v04` frontend; the historical v0.3
G3 app remains isolated and builds from its original contract.

**Important:** the hosted demo serves only `/health`. Production OIDC,
managed PostgreSQL, backups and operational release hardening are **not**
part of the verified pilot; P4 ROI, P5 adoption and P6 release remain open.

## Product-first Java vertical slice

The current goal is **one generated Spring Boot application with a typed implementer-owned business handler**, not parallel handwritten controllers. See [product execution plan](docs/PRODUCT_FIRST_PLAN.md) and [catalog example](examples/catalog-vertical/README.md). P4 experimental records remain separate.

## Why

LLMs can help resolve ambiguous requirements and propose contracts. ProtocolIA's **primary vNext goal** is compiling reviewed contracts into complete, functioning software for declared supported profiles. Historical token-efficiency and agent-economics experiments are secondary and do not gate application generation.

## P1: formal versioned contracts (v0.2)

The `0.1` compiler remains supported with byte-identical golden outputs. Opt-in `0.2` contracts additionally support strict scalar bounds, limited safe anchored patterns and typed enums with executable `validate_payload`, exactly bound URI parameters, generated JSON Schema, conservative compatibility diagnostics and explicit migration.

```sh
protocolia validate examples/sales-v0.2.json
protocolia compile examples/sales-v0.2.json --out generated-v02
protocolia preview examples/sales-v0.2.json --out generated-v02
protocolia migrate examples/sales.json > migrated.json
protocolia diff migrated.json examples/sales-v0.2.json
```

Cross-version diff requires explicit migration to the same contract version; `migrate` never writes or applies database changes. Existing v0.1-owned outputs must not be reused as v0.2 output directories.

See [v0.2 semantics](docs/P1-V02-CONTRACT.md), [standards/interop ADR](docs/ADR-001-MODELING-STANDARDS.md), [roadmap](docs/ROADMAP.md), and [execution evidence](docs/EXECUTION_STATE.md). `0.2` remains an experimental contract language; *no generated server, production authorization, business transaction correctness, or model-token savings are claimed.*


## What actually works in v0.1

- Strict JSON contract validation, unknown-field rejection, reference checks, unique endpoints, typed dependencies, stable topological order, explicit capabilities and read/write effects.
- Deterministic IR (`ir.json`), OpenAPI 3.1 (`openapi.json`), TypeScript wire types (`types.ts`), and SHA-256 artifact manifest (`manifest.json`).
- Protected regeneration: refuses to overwrite manually modified/unmanaged output files; rejects symlinked output directories and filenames.
- Python standard library only. No model, API key, network service, database, cloud platform, or dynamic execution required.

**Not yet implemented:** runtime business invariants, server implementations, database migrations, tests for generated services, agent scheduler/executor, model integration, caching, latency/token claims, semantic behavioral equivalence. An OpenAPI schema is **not** proof that an implementation is secure or correct.

## P0 installation and independent verification

A published console entry point is provided by `pip install .` (Python 3.11+). GitHub CI validates the generated OpenAPI 3.1 with `openapi-spec-validator==0.7.2` and checks emitted wire types with TypeScript 5.8.3. These are **test-only dependencies**: ProtocolIA itself still has no runtime external packages or model API dependency.

The independent [ProtocolIA-Test](https://github.com/barbasmarcosi/ProtocolIA-Test/pull/1) repository pins the upstream compiler to a verified commit and runs separate inventory fixtures. See [execution state](docs/EXECUTION_STATE.md) and [benchmark registration](benchmarks/README.md). **No server, domain invariant or runtime authorization is generated or verified yet.**

## Try it

Requires Python >=3.11. From the repository root:

```sh
python -m pip install .
protocolia validate examples/sales.json
protocolia compile examples/sales.json --out generated
python -m unittest discover -s tests -v
```

Inspect `generated/openapi.json`, `generated/types.ts`, `generated/ir.json`, and `generated/manifest.json`. Output is ignored by Git. Changing a contract regenerates its outputs; manually editing a generated file instead causes a fail-closed error. Delete a generated output folder consciously if you need to discard local edits.

## Design principles

1. **Semantics before syntax.** Contracts express supported structure and effects, not free-form instructions that are silently treated as executable truth.
2. **Never fabricate enforcement.** Capabilities and effects are declared metadata for now, not enforced permissions. No business invariant is claimed without executable support.
3. **Fail closed.** Reject unknown grammar, references, routes, effects, or modified artifacts.
4. **Provider-free core.** AI proposes contracts; ProtocolIA validates/compiles them deterministically.
5. **Reproducible first.** Stable output order, explicit spec version, pinned transformations, recorded content hashes.
6. **Adopt standards.** Generate OpenAPI; evaluate Smithy, CUE, JSON Schema, and Spec Kit rather than inventing a language casually.
7. **Measured benefit.** Optimize cost per *verified successful* task, correctness, latency, and verifiable evidence—not code volume or token count alone.
8. **Adapter architecture.** ProtocolIA's core must not import TrueMaestro or a single model SDK.

## Navigating the project

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): component boundaries, contract semantics and future IR/runtime design
- [`docs/RESEARCH.md`](docs/RESEARCH.md): prior art, hypothesis, experiment design and kill criteria
- [`docs/ROADMAP.md`](docs/ROADMAP.md): incremental milestones and gates
- [`docs/SECURITY.md`](docs/SECURITY.md): threat model and explicit non-guarantees
- [`examples/sales.json`](examples/sales.json): example contract

ProtocolIA starts with a narrow, falsifiable vertical slice. The vision is broad; the implemented scope is intentionally small.

## License
MIT; see [`LICENSE`](LICENSE).

## P3: verified local action engine (v0.4)

ProtocolIA generates and validates a separate agent action DAG. The provider-free runtime supports only closed local operations (literal, SHA-256, equality assertion, SQLite key/value access), with exact-scoped host policy, atomic event/evidence journal, replay invalidation, concurrency-safe deduplication and evidence expiry. Try `protocolia action-preview examples/action-plan-v0.4.json --policy examples/action-policy-v0.4.json`. For effectful execution, pass `action-run` with `--environment` and an existing, trusted workspace as `--out`. This is **not** an OS sandbox or autonomous shell/network executor; see [P3 boundaries](docs/P3-ACTION-RUNTIME.md) and [execution state](docs/EXECUTION_STATE.md).

## P3-B1: external read-only Docker proof

A second, explicitly bounded host API and CLI now supports only immutable, allowlisted file hashing in Docker: `python -m protocolia.sandbox_cli preview/approve/run/revoke`. It requires an operator-managed HMAC secret and input/ledger directories, an immutable local image ID, zero-dollar policy and trusted Docker daemon. External plan effects **are not wired into the P3-A DAG**. The host must authenticate operators and protect its approval secret; the CLI does not provide human identity. See [sandbox threat model](docs/P3-DOCKER-ADAPTER.md) and [exact CI evidence](docs/EXECUTION_STATE.md).

## P3-B2.1 — typed host-approved read-only broker

The provider-free action_broker provides validate_broker_plan, preview_plan, approve_plan and run_plan for a strict v0.5 DAG: pure computations and exactly one Docker file.sha256 read. The trusted host, never the model, chooses credentials, image and resource grants and issues a signed approval tied to the entire plan and policy. The v0.4 local SQLite executor remains separate; no general external writer, human login, paid cost ledger or atomic cross-process transaction is claimed. See docs/P3-B2-READONLY-BROKER.md and docs/EXECUTION_STATE.md.

## P3-B2.2 — operator-signed approvals (opt-in)

Install optional Ed25519 support: `python -m pip install '.[operator-auth]'`. The new `protocolia.operator_auth` gateway authenticates possession of an operator's registered Ed25519 key and checks exact resource permissions against a host-owned registry. The operator's **offline** `python -m protocolia.operator_signer` CLI creates a local 0600 key and signs a reviewed plan/resource intent; the executor holds only the public registry and a private 32-byte host HMAC key. Signatures are domain separated, short-lived, nonce-unique and invalidated on key revocation/registry change. [Operator authentication threat model](docs/P3-B2-OPERATOR-AUTH.md) and [exact independent CI](docs/EXECUTION_STATE.md). This is **not** an OIDC/MFA human login service, unrestricted agent, paid tool or writable external executor. The underlying direct HMAC approval APIs are trusted-host internal only and must not be exposed to models.

## P3-B3/B4: local operator approval service and cost reservation

Linux-only, trusted-host entry point: `python -m protocolia.operator_service --config /ABSOLUTE/private-host-config.json`. It binds a 0600 Unix socket in a dedicated 0700 host workspace, checks Linux SO_PEERCRED, uses an operator-held Ed25519 signature, and permits only one already-scoped Docker file hash operation. The model cannot choose host keys, policy or image. The service must run under a separate trusted OS UID, not the model process. See [host service](docs/P3-HOST-AND-COST.md).

CostLedger offers SQLite-backed integer micro-USD reservation and signed usage-settlement **primitives**: trusted quote, immutable budget ceiling, durable `started` marker and no refund after an ambiguous started call. No paid provider is integrated and no production identity/MFA or general writable tool has been demonstrated; P3 remains IN PROGRESS. [Execution evidence](docs/EXECUTION_STATE.md).

## P4 — Compare Codex/Claude Code subscriptions, no API keys

A provider-free empirical study harness is available as `python -m protocolia.p4_benchmark`. It freezes balanced direct-agent / conventional generator / ProtocolIA trials against independently pinned Java/Spring task specs. Choose a separately preregistered Codex or Claude Code pilot; run the agent **locally on your own already-authenticated subscription CLI**, not in CI or using OpenAI/Anthropic API keys. Import CLI-reported token counters (null if unavailable), elapsed time, trial repairs and independent HTTP verdicts; completed records preserve hashes, not raw conversations. A frozen study is not a benchmark outcome: **no real agent trials or subscription savings have been measured**. Full commands and limitations: [P4 CLI runbook](docs/P4-SUBSCRIPTION-CLI.md).

## P4 local subscribed-agent trial execution

The P4 study now has a local, explicit-opt-in runner (`python -m protocolia.p4_local_runner prepare` / `run --execute`) and independent verifier importer (`python -m protocolia.p4_trial_finalize`). It checks exact Git-pinned tasks and prompt hashes, requires a model name, saves raw CLI traces privately, runs the independently pinned black-box verifier, and records failed as well as successful attempts without fabricating subscription USD. Real agent quota is consumed ONLY on a user's own installed/logged-in Codex or Claude CLI, never in GitHub Actions. See [local runner guide](docs/P4-LOCAL-RUNNER.md). **All CI used fake CLIs; no genuine agent runs or economic savings have been observed.**
