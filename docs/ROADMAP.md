# Roadmap and hard gates

All milestones require evidence, not just merged code. Items checked only after local/CI verification.

## P0: Minimal falsifiable compiler — current slice

- [x] Versioned strict JSON contract grammar, deterministic validation and semantic errors
- [x] Canonicalized model/operation IR with acyclic dependency order
- [x] OpenAPI 3.1 and TypeScript wire type emitters
- [x] Content-hash manifest, protected regeneration, no provider calls
- [x] Python unit tests (14 focused cases run locally)
- [ ] CI green on GitHub; installation/packaging smoke verified on clean environments
- [ ] Golden snapshots and external OpenAPI/TypeScript validation

## P1: A credible contract model

- [ ] Publish normative JSON Schema, schema evolution strategy and migration tooling
- [ ] Add typed constraints (`min`, `max`, `pattern`, `enum`, uniqueness) with executable validation, never decorative string labels
- [ ] Supported path parameters; nested/optional/list/reference semantics and generated TypeScript validation
- [ ] Externally validate generated OpenAPI 3.1 with conformance tooling
- [ ] Add safe API compatibility diff (breaking vs additive) and generated-file ownership policies
- [ ] Evaluate Smithy/CUE import/export via documented fidelity tests

## P2: One complete vertical domain slice

- [ ] One target framework only (e.g. FastAPI), generated interfaces and server stubs with explicit TODOs
- [ ] Mapped DTO validators and request/response contract tests
- [ ] No automatic implementation of domain invariants without formal semantics
- [ ] Migration preview; no destructive migration on an unreviewed contract
- [ ] Generated code is compilable and typechecked in CI; repeatable regeneration

## P3: Effectful runtime and planner

- [ ] Typed action IR, dependency/dataflow graph and independent-op parallel scheduling
- [ ] Capability tokens, tool sandbox and execution budgets enforced at runtime
- [ ] Persistent evidence store with hash-bound provenance and invalidation
- [ ] Idempotency scopes and safe retry rules, compensations where appropriate
- [ ] No silent fallback from violated constraints to LLM guessing

## P4: Model adapters and empirical validation

- [ ] Model adapter proposes contract with provenance and ambiguity flags
- [ ] Contract validation independent from model; explain exact failures for repair
- [ ] Compare baseline vs templates vs ProtocolIA on preregistered benchmark
- [ ] Account token usage, USD, elapsed time, pass rates and reviewer effort
- [ ] Ship only when gains persist and safety/migration gates pass

## P5: Research frontier (optional)

- [ ] Cross-stack generation and contract composition
- [ ] Incremental compilation / reusable evidence
- [ ] E-graph or optimizer passes **only if** equivalent operations can be proven
- [ ] Explore latent model communication only as a separate experiment; never require it

## Explicit non-goals in early versions

New general-purpose programming language, arbitrary AI-generated execution without review, self-modifying compiler, implementation of an entire UI from vague contracts, replacement of relational databases, and claims of formally verified business logic without proofs/tests.
