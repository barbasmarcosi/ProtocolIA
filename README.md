# ProtocolIA

**Contracts before code. Evidence before claims. Intelligence only where it is needed.**

ProtocolIA is a provider-independent research and engineering project for compiling typed software contracts into deterministic artifacts, and into narrowly constrained, auditable local action plans (v0.4). A separate experimental read-only Docker tool is supported only via a trusted host; arbitrary privileged/external agent tools remain unsupported. It is **not** a general-purpose programming language, a replacement for LLMs, or an autonomous coding agent.

## Why

LLMs are powerful at ambiguity, design, and novel problems. They should not have to regenerate routine DTOs, interfaces, API schemas, and execution plans on every request. ProtocolIA tests the hypothesis that *verified contract compilation reduces model work per successful mission without reducing quality*.

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
