# ProtocolIA — Master Execution Roadmap

**Status:** planned and gated; updated 2026-10-10  
**Source of execution truth:** [EXECUTION_STATE.md](EXECUTION_STATE.md)  
**Existing tracking issues:** [P0 #6](https://github.com/barbasmarcosi/ProtocolIA/issues/6), [P5 #7](https://github.com/barbasmarcosi/ProtocolIA/issues/7), [P6 #8](https://github.com/barbasmarcosi/ProtocolIA/issues/8), [P1 #2](https://github.com/barbasmarcosi/ProtocolIA/issues/2), [P2 #3](https://github.com/barbasmarcosi/ProtocolIA/issues/3), [P3 #4](https://github.com/barbasmarcosi/ProtocolIA/issues/4), [P4 #5](https://github.com/barbasmarcosi/ProtocolIA/issues/5).

> **North star:** Convert explicit, typed, versioned intent into software artifacts and auditable execution plans while minimizing *unnecessary model decisions*—without trading away correctness, security, or maintainability.

## 0. Definition of success and boundaries

ProtocolIA is **two products sharing a compiler foundation**, not a replacement general-purpose language:

1. **Contract-to-software:** schemas and supported behavior contracts → canonical IR → deterministic generators → independently testable software.
2. **Contract-to-execution:** typed operations, prerequisites, effects, permissions, costs and success evidence → bounded, auditable plans → constrained executor.

The model is an optional, untrusted **intent adapter**. It may draft contracts and resolve genuinely ambiguous requirements; it never decides whether its own output is valid, authorized, correct or verified. **The compiler must work without a provider.**

**Do not claim** formal correctness from generated code, OpenAPI declarations, hashes, passing unit tests, or a successful agent run. Evidence must be matched to the exact claim. Supported invariants require executable semantics and adversarial tests.

### Invariants across every phase

- Fail closed on unknown/unsupported syntax, effects, versions, capabilities, providers or verification status.
- Deterministic, canonical output for a pinned compiler + generator + contract; no secret-dependent build output.
- No execution of arbitrary untrusted code or shell commands embedded in contracts. No implied permission to touch production.
- Contract/IR/API compatibility and regeneration safety are required; hand-authored code is not silently replaced.
- Independent verification, provenance and evidence invalidation remain separate from proposer/generator.
- Optimize **all-in cost per independently verified successful mission**, subject to quality and security non-regression; report failures and negative results.
- Minimize dependencies and GitHub Actions spend. Keep deterministic CI provider-free; never require paid models for basic quality gates.

## 1. Architecture and dependency graph

```text
                    intent / external IDLs / optional LLM
                                    |
                         untrusted proposal adapter
                                    |
                    P1: schema + semantic validator
                                    |
                  contract AST -> typed, canonical IR
                                /         \
       P2: deterministic software          P3: typed action IR
       generators and contract tests        and capability runtime
                                \         /
                         evidence + provenance
                                    |
                   P4: A/B/C independent evaluation
                                    |
                P5: real-repository pilots (dry-run first)
                                    |
                    P6: stabilization / v1 decision
```

**Critical path:** P0 → P1 → P2 → P4 → P5 → P6. P3 starts with a separately typed action IR only after P1 contract semantics are stable; P3 can progress in parallel with P2 but **must be independently gated before any effects execute**. Benchmark **instrumentation and task registration begin in P0/P1**, not after observing P2 outcomes.

Do **not** treat HTTP operation dependencies from v0.1 as executable agent scheduling dependencies. Keep distinct types, rules, schemas and namespaces until justified by actual shared semantics.

## 2. Milestones with hard exit gates

### P0 — Trustworthy v0.1 baseline (release candidate v0.1; issue #6)

**Verified baseline:** feature branch `feat/contract-compiler-v0`, PR #1 open/draft, HEAD `72ce089aba85c1d12409955e4591456a2cd0b454`; 14 unit tests reported locally; GitHub `quality` workflow completed successfully for this SHA (run 38079598479). This is **not** a declaration that packaging, cross-tool conformance or application behavior are validated.

**Deliverables**
- [x] Strict JSON v0.1 parser, semantic reference checks, reject duplicate routes and invalid effects, stable acyclic ordering.
- [x] Canonical IR, OpenAPI 3.1, TypeScript types and SHA-256 manifest; regeneration protection.
- [x] Provider-free CLI, focused unit tests and GitHub quality workflow at cited SHA.
- [x] Installed package CLI smoke on Python 3.11 and 3.13 in CI (clean isolated installation).
- [x] Frozen golden hash fixtures, adversarial failures and reproducible output verified across CI Python jobs.
- [x] Independent OpenAPI 3.1 validation and TypeScript 5.8.3 typecheck of generated output.
- [x] Provider-free import, negative fixtures for hostile outputs/regeneration and independent consumer compilation. (No network outage simulation or race-free filesystem claim.)
- [x] Register P0 smoke-task catalog and machine-readable run evidence schema; **P4 held-out tasks/measurements remain unregistered and unmeasured**.

**Exit:** fresh checkout → installation → validation → generation → re-generation → independent output checks pass; generated hashes stable; no unsupported feature represented as safe.

### P1 — Formal contract language and compiler semantics (v0.2; issue #2)

**Purpose:** offer a strict, versioned, provider-free language with executable supported constraints and explicit compatibility behavior.

**Evidence-backed acceptance (code changes validated on 2026-10-10):**
- [x] Normative strict v0.1 JSON Schema draft 2020-12, differential 34-case structural/semantic acceptance corpus, downstream consumer P1-A CI.
- [x] Normative v0.2 structural JSON Schema, separately versioned normalizer; v0.1 canonical output and pinned golden SHA-256 hashes preserved.
- [x] Supported scalar constraints: numeric minimum/maximum, string minLength/maxLength and safe anchored pattern subset, typed scalar enum; unsupported predicates rejected.
- [x] Executable `validate_payload` with recursive nested model/array validation; independently check representative cases with JSON Schema 2020-12.
- [x] Exact path parameter names and binding types, overlapped-route rejection, OpenAPI 3.1 parameter conformance, executable `validate_path_params`.
- [x] Explicit v0.1→v0.2 grammar migration via CLI; conservative within-version compatibility diff via CLI and independent consumer.
- [x] Protected output ownership manifest and no-write `preview`; v0.1→v0.2 generated-output ownership isolation.
- [x] Independent OpenAPI 3.1 and TypeScript 5.8.3 checks for generated v0.2 outputs, Python 3.11/3.13 unit tests and external ProtocolIA-Test v0.2 consumer CI.
- [x] Smithy/CUE/OpenAPI/JSON Schema feature-fidelity matrix with an explicit interoperability decision recorded in ADR-001; **no unimplemented importer/exporter claimed**.

**Accepted P1 limits / tracked follow-up:** v0.2 reference semantics are validated but IR continues as canonical Python dictionaries rather than a complete immutable typed AST; optional/null remains intentionally distinct and null unsupported. No arbitrary cross-field predicates, transaction/idempotency guarantees, auth runtime, server/DB migration generator or Smithy/CUE round-trip importer. Smithy/CUE executed round-trip conformance belongs to optional interoperability work in P5 if justified. Strict external consumer-driven compatibility is required for live API upgrades; this P1 classifier is conservative syntax analysis.

**Exit gate:** only supported constraints compile into standards-compatible artifacts AND have reference runtime verification; backward compatibility is explicit; independent consumers and pinned CI pass. See [P1 v0.2 contract](P1-V02-CONTRACT.md), [ADR-001](ADR-001-MODELING-STANDARDS.md) and [execution state](EXECUTION_STATE.md).

### P2 — Executable vertical slice: inventory and sale (v0.3; issue #3)

**Platform choice:** Java backend proposal; keep generator interface language-independent so other targets can be added only after P4 proves meaningful value. Target decision is tracked in [ADR-002](ADR-002-JAVA-BACKEND.md).

**Purpose:** prove a contract produces more than DTOs and routes.

**First stack (proposed P2 target change):** Java 21 + Spring Boot 4.x + Maven + PostgreSQL. Pin exact patch versions when implementing, and verify runtime/toolchain compatibility in CI. The ProtocolIA compiler remains Python/provider-free; Java is a generated backend, not a replacement compiler implementation. Use JUnit 5, Spring MVC/Bean Validation and Testcontainers PostgreSQL for independent HTTP, database and concurrency checks. Do **not** rely on in-memory-only SQLite/H2 for evidence of transactional correctness. Before inventing Java scaffolding, compare the outcome against OpenAPI Generator's maintained `spring` server generator with its Boot 4 configuration.

**Deliverables**
- [ ] Generate Java records/DTOs, Spring MVC controller interfaces, request/response validation, OpenAPI, TypeScript client types and independent contract tests. Generated endpoints must fail explicitly for unimplemented business logic.
- [ ] Generate only explicitly supported JPA/persistence boundaries and Flyway migration previews; never execute DDL or destructive migrations on unreviewed contracts.
- [ ] Implement a **named executable template/rule** for atomic inventory decrement; define preconditions, postconditions and DB transaction boundaries. A contract label alone is insufficient.
- [ ] Protect duplicate sale submission with idempotency-key scope, replay behavior and race tests; specify failure and timeout semantics.
- [ ] Map contract capabilities to an actual Spring Security request/method enforcement policy in the generated sample runtime; independently prove unauthenticated and unauthorized requests are rejected.
- [ ] Golden fixture demo: `product → register sale → stock movement`; happy path, stock shortage, concurrent purchase, duplicate request, transaction rollback and malicious input.
- [ ] Deterministic regeneration that preserves custom application code; no unsafe migration by default.
- [ ] Clean checkout runs Maven compile/test and starts generated Spring Boot service; independently compare actual HTTP behavior against OpenAPI and ProtocolIA constraints. Include an A/B comparator against unmodified OpenAPI Generator Spring server scaffolding.

**Exit:** reproducible generated demo can be executed and negative/integration/concurrency tests pass on **the stated target DB and framework**. Unsupported guarantees remain visibly unimplemented, not implicitly trusted.

### P3 — Auditable agent execution engine (v0.4; issue #4)

**Purpose:** remove repeated model decisions for well-defined operations, **not** turn passive capability labels into authority.

**Deliverables**
- [ ] Define a separate typed action IR: inputs/outputs, dependency + dataflow edges, declarative effects, preconditions, postconditions, idempotency and timeouts.
- [ ] Build a static planner with stable ordering; parallelize only operations with proven independent dataflow **and non-conflicting effects**.
- [ ] Create a minimal allowlisted executor with capability enforcement at action/resource scope, isolated working area, deny-by-default network/filesystem access and execution budgets.
- [ ] Persist evidence bound to contract hash, tool/generator version, inputs, environment and results; define freshness, invalidation and replay semantics.
- [ ] Retry only idempotent or specifically compensated operations; bound retries/cancellation and prevent double spending of reserved budgets.
- [ ] Add dry-run plan review, operational event log, failure diagnostics and human approval boundary for privileged actions.
- [ ] Adversarial tests: forged capability, traversal, symlink, conflicting effects, replay/double write, stale evidence, budget overflow, partial failure and cancellation.

**Exit:** provider-free demo executes a safe DAG with audited capabilities and can deny all forbidden actions; no unrestricted generated shell/script execution; recovery uses only demonstrably valid evidence.

### P4 — Optional AI adapters and preregistered A/B/C evaluation (v0.5; issue #5)

**Purpose:** prove a measurable benefit over **both** direct agents and ordinary generators.

**Three arms**
- **A:** coding agent implements a task directly.
- **B:** the same class of agent uses existing templates / OpenAPI generators, *without* ProtocolIA.
- **C:** agent proposes ProtocolIA contract → deterministic compile/generate → agent repairs only unsupported or failed work.

**Deliverables**
- [ ] Provider-independent adapter protocol: model input/output schema, uncertainty flags, structured validation feedback and bounded repair attempts. No model dependency in the core.
- [ ] Preregister held-out tasks, evaluation scripts, seeds, model versions and resource budgets **before reviewing comparative scores**.
- [ ] Task groups: new CRUD, domain invariants, brownfield changes, contract evolution, ambiguous/malicious instructions and non-repetitive algorithms.
- [ ] Standard event ledger: provider/model, prompt/cache/response tokens, USD (including unknown cost), tools/runtime, test time, retries, human interventions, wall latency and quality evidence.
- [ ] Instrument zero-provider baselines first, followed by small-budget pilots; repeat nondeterministic comparisons and attach uncertainty intervals.
- [ ] Independent tests/reviewers judge semantic correctness and security. Publish failures, negative results, protocol deviations and raw reproducible evidence.

**Primary metric:** total spend for a cohort / independently verified successful missions in that cohort, reported **together** with completion rate and uncertainty. Secondary: latency, verifier labor, repair count, reproducibility, security-policy violations.

**Decision:** prefer C only if it credibly improves cost per successful mission on selected recurring tasks **against both A and B** with no unacceptable correctness/security degradation. Use **20% improvement** as an initial *research target*, not an unconditional pass threshold. If B is indistinguishable or better, reuse B and halt ProtocolIA's extra complexity for that task class.

**Exit:** independently reproducible reports support a bounded claim (including task class and provider), not a generic "saves tokens" claim.

### P5 — Controlled adoption and interoperability (v0.6; issue #7)

**Purpose:** validate ProtocolIA outside its own examples without coupling its core to another project.

**Deliverables**
- [ ] Read-only/dry-run adapter in TrueMaestro, retaining all existing cost, approval, provider and sandbox policies.
- [ ] GastroApp proof of integration for a bounded contract/API change (not direct production writes).
- [ ] At least one independently selected repository not used to tune templates or prompts.
- [ ] OpenAPI import/export with documented loss reporting; optional Smithy/CUE bridge only if P1 fidelity evaluation justifies it.
- [ ] Benchmark brownfield regeneration drift: manual patches preserved, compatibility regressions surfaced, migrations never applied by surprise.
- [ ] Independent consumer contract tests, evidence pack and rollback rehearsal.

**Exit:** at least two independent consumers can evaluate ProtocolIA in dry-run without losing existing safety controls; greenfield-only success cannot justify the adoption claim.

### P6 — v1 release decision and maintenance discipline (issue #8)

**Purpose:** decide whether ProtocolIA has proved a maintainable, reusable contribution.

**Deliverables**
- [ ] Versioned stable core APIs and compatibility policy, reproducible release artifacts, signed/tagged releases where supported.
- [ ] Threat-model review; fuzz/property tests on parser/IR and malicious regeneration cases; dependency provenance.
- [ ] CLI quick start, contract cookbook, generator author guide, explicit supported/unsupported guarantees and upgrade guide.
- [ ] End-to-end reproducibility from fresh checkout, platform matrix, realistic performance resource budgets, independent review.
- [ ] Published assessment of measured wins, measured losses, total maintenance burden and what not to build.
- [ ] Integrator-facing conformance fixtures and a clear path to external contributions.

**Exit:** either release a constrained v1 with evidence-backed claims **or** explicitly declare research outcome/no-go. A no-go with good evidence is a successful research result.

## 3. Prioritized next engineering work (without skipping gates)

1. **P0-A:** update this roadmap/state and document verified green CI. Remain Draft; don't merge merely because docs were updated.
2. **P0-B:** external OpenAPI + TypeScript validation and installed CLI smoke in CI.
3. **P0-C:** corpus/golden tests and hostile input/regeneration negatives; publish exact fixture hashes.
4. **P1-A:** normative JSON Schema + semantic agreement suite.
5. **P1-B:** typed constraints and exact path binding semantics.
6. **P1-C:** contract versioning + compatibility diff; Smithy/CUE proof-of-fit ADR.
7. **P2-A:** minimal FastAPI backend generation, isolated and reproducible.
8. **P2-B:** supported transactional inventory/idempotency semantics + independent DB tests.
9. **P2-C:** contract-to-runtime conformance evidence.
10. **P3-A:** isolated action IR and capability policy validator (no execution yet).
11. **P3-B:** safe bounded executor and provenance/caching.
12. **P4-A:** metric ledger and preregistered benchmark; optional provider adapters only after offline gates.

**Operating rule:** finish the active gate's evidence and update EXECUTION_STATE before moving to the next. Avoid unrelated refactors and scope creep. Each PR should represent one independently verified acceptance slice, with implementation, tests, negative tests, artifacts and a clear rollback. Do not rely on GitHub Actions alone when minutes/budgets are limited.

## 4. Effort and risk (relative sizing; not delivery promises)

| Phase | Relative effort | Principal uncertainty | Kill/re-scope signal |
| --- | --- | --- | --- |
| P0 | S | Packaging/external conformance | Outputs are not consumable by external tools |
| P1 | M–L | Semantics, migrations, IDL compatibility | Contract grammar duplicates proven standards without added utility |
| P2 | L | Real transactional correctness and regeneration | Most work still needs manual LLM fixes |
| P3 | L–XL | Capability isolation, effect algebra, replay | Executor cannot be safely bounded |
| P4 | M–L | Valid benchmarking, provider variance | C loses to ordinary generators |
| P5 | L | Brownfield integration and API drift | Works only in self-authored examples |
| P6 | M | Long-term compatibility/security | Maintenance costs exceed measured benefit |

P3 and provider-backed benchmarks have the highest potential operational risk/cost. The **first economic kill gate is P2 → P4**, before any ambitious runtime investment: quantify how much of generated application work is really deterministic.

## 5. Research discipline / anti-overengineering

- **Do not invent a general-purpose language, a universal latent representation, a new general scheduler, or model-specific tokens as product requirements.**
- **Do not implement a feature twice** if an existing, maintained standard/generator solves it with equivalent guarantees. Evaluate with a fidelity and maintenance matrix first.
- Never treat feature scaffolding, OpenAPI output, unit-test counts or model self-review as independently verified domain correctness.
- Avoid the false dichotomy between no-LLM and full-agent: use the model only for missing semantic decisions, not for mechanically known transformations.
- Keep uncertainty explicit, including whether a claim is measured, hypothesized, simulated, or demonstrated only for one stack.
- If the P2 generated-service experiment does not beat standard generators on meaningful workflow measures, narrow ProtocolIA to a contract compiler or pursue P3 as an **independent** hypothesis, not as sunk-cost justification.

## 6. Execution state and provenance

Track on every delivery: date, branch, commit, gate, checklist evidence, remaining blockers, comparison baseline and next atomic slice. Evidence should include specific test commands and artifacts, not adjectives like "ready" or "10/10". See [EXECUTION_STATE.md](EXECUTION_STATE.md).

**External references for design review** (not dependencies): [OpenAPI](https://spec.openapis.org/oas/), [JSON Schema](https://json-schema.org/specification), [Smithy](https://smithy.io/2.0/spec/), [CUE](https://cuelang.org/docs/), [OpenAPI Generator](https://openapi-generator.tech/), [JHipster JDL](https://www.jhipster.tech/jdl/getting-started/), [LLMCompiler](https://github.com/SqueezeAILab/LLMCompiler), [DSPy](https://dspy.ai/).
