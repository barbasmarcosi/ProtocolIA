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

### P2 — Executable Java Spring Boot inventory-sale vertical slice (v0.3; issue #3)

**Status: COMPLETE within the explicitly supported profile**, merged via ProtocolIA PR #13 (generator/runtime) and PR #12 (Java ADR); independent ProtocolIA-Test PR #5 also merged.

**Stack:** Java 21, Spring Boot 4.0.2, Maven, Spring MVC/Security, Jakarta validation, PostgreSQL 16, Spring JDBC, Flyway migrations default-disabled and JUnit 5/Testcontainers.

- [x] Provider-free deterministic Java DTO/record, MVC and supported constraint generation. Unimplemented generic business endpoints explicitly return 501.
- [x] Named fail-closed inventory-sale contract translates into actual JDBC business transactions; arbitrary business predicates are NOT generally synthesized.
- [x] Atomic guarded stock decrement, PostgreSQL CHECK and UNIQUE constraints, transactional rollback and idempotency under concurrent requests.
- [x] HTTP 200/400/401/403/404/409, unknown-field rejection, real Spring method-level authorization, viewer write denial, invalid data rejection.
- [x] JUnit5/Testcontainers PostgreSQL concurrency, rollback and replay tests; generated service builds under Maven clean package.
- [x] Independent ProtocolIA-Test contract generates/runs its own service and confirms HTTP semantics with ephemeral PostgreSQL.
- [x] Safe regeneration refuses modified/unmanaged source; Flyway defaults off; no production migration or privileged filesystem guarantee.
- [x] OpenAPI Generator Spring Boot 4 conventional baseline generated from the same OpenAPI. This is a scaffold comparison, not an economic benchmark.

**Exact evidence:** ProtocolIA implementation SHA 5b4f16733acd1dc6f14b1dec51aa22cd2d48ece7; successful java-inventory run https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088656004, java-target https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088655993, quality https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088655983, baseline https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088652081. Independent consumer SHA 2c78ca2167dab7ab33dd043dca8d82272dbca963, successful https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38088760781.

**Limits:** no arbitrary business program synthesis, no production identity provider or TLS hardening, unsupported enum and optional/null Java semantics are rejected, no general migration approval engine, no safe concurrent hostile filesystem writes, no measured cost/token savings. P4 must measure that independently.

**Exit:** The concrete generated inventory-sale service builds, executes and passes negative/concurrency/rollback tests on real PostgreSQL, independently consumed. P2's bounded gate is satisfied; wider generator claims require separate gates.

### P3 — Auditable action plans (v0.4; issue #4)

**Status: IN PROGRESS. P3-A local reference runtime is implemented, merged and independently verified. P3-B1 restricted Docker isolation/approval is verified; P3-B2.1 typed read-only broker and P3-B2.2 Ed25519 operator key-possession gateway are verified; deployed human enrollment/MFA, writable/paid tools and cost recovery remain unimplemented.** See [execution evidence](EXECUTION_STATE.md), [P3 runtime contract](P3-ACTION-RUNTIME.md), upstream PR #15 and ProtocolIA-Test PR #6.

**P3-A verified:**
- [x] Separate typed action IR 0.4, with input/output references, effect typing, typed equality postconditions, DAG validation, per-action cooperative timeouts and deterministic serial ordering.
- [x] Strict positive/negative structural JSON Schemas and semantic checks; unsupported tools or effect types rejected, no arbitrary Python/shell or network action.
- [x] Host-owned policy enforces explicit action/resource capabilities, action count, write count and time budget **before** any local effect.
- [x] Closed SQLite local KV adapter with transactional effect/journal commit, append-only-sequenced event evidence, stable tool version + plan/policy/environment/input/output fingerprints.
- [x] Same-mission concurrent execution commits one set of effects; matching replay returns committed evidence; stale records, environment/policy/plan drift, altered state, forged events, future/expired evidence denied.
- [x] Dry-run without journal creation, atomic rollback on failed postcondition/cancellation/timeout, traversal and symlink rejection.
- [x] ProtocolIA-Test independent Python 3.11 and 3.13 tests for forged grant, forbidden shell, traversal, timeout/cancellation, concurrent replay, TTL expiry and modified evidence.
- [x] P0/P1/P2 regression CI remains green for the exact P3 implementation commit.

**P3-B1 verified: restricted, read-only isolated external adapter (not general tool execution):**
- [x] One fixed file.sha256 operation executes as an unprivileged Docker process, pinned to a local image SHA-256 ID, with network none, read-only root and bind-mounted byte snapshot, ALL capabilities dropped and resource limits; actual Docker CI probes demonstrate no egress, host socket access or writable mounts.
- [x] Trusted host resource allowlist, O_NOFOLLOW input traversal, size limit and zero-dollar known-cost policy are checked before creating any external attempt.
- [x] Explicit host-issued HMAC approval bound to exact input, request, policy, environment, declared subject, expiration and fixed tool fingerprint; revocation validates the signer secret, so an arbitrary key cannot revoke.
- [x] One durable attempt per immutable request ID, no ambiguous automatic retry, successful exact replay, timeout quarantine and best-effort container cleanup, results re-verified and rejected after revocation.
- [x] A separate ProtocolIA-Test fixture exercises actual Docker, approval/revocation, stale input and TTL, forged revocation, concurrent clients, traversal/symlink and forbidden paid/shell operations.
- [x] P3-B1 and independent CI passed on pinned exact commits, and code merged to both main branches.

**P3-B2.1 implemented and independently verified:**
- [x] Versioned v0.5 typed DAG integrates exactly one Docker file.sha256 read with pure typed computations and equality assertions; normative plan and host-policy JSON Schema.
- [x] Host-owned resource permissions and time/read/action budgets, request ID bound to entire plan and host policy hashes; no model-selected process, image, host resource path, or signing key.
- [x] Existing isolated Docker read operates only after explicit HMAC host approval; stale plan/policy/bytes, revocation and forged capabilities denied. Known-zero paid-provider cost only.
- [x] Live Docker integration and independent ProtocolIA-Test own binary fixture with concurrent callers, idempotency, negative access and postcondition checks. PR #20 and consumer PR #9 merged.

**P3-B2.2 implemented and independently verified: cryptographic operator key possession**
- [x] Operator-held Ed25519 private key signs a domain-separated canonical intent; trusted host has only a protected public-key registry. Declared subject alone no longer suffices for new gateway approval.
- [x] Consent binds entire plan, exact logical resource, tool, immutable image ID, host and Docker policies, input hash, tool fingerprint, environment, key ID, registry digest, nonce and bounded expiry.
- [x] Operator CLI generates 0600 raw private keys locally and refuses signing without exact plan SHA and resource confirmation. Private key never enters the trusted executor or container.
- [x] Protected 0600-equivalent host HMAC key and registry, UID and symlink/hardlink checks; durable single-use nonce before issuing host HMAC grant; signer-key revocation and rotation invalidate old replays.
- [x] Python 3.11/3.13 cryptographic adversarial CI, actual Docker integration and independent ProtocolIA-Test consumer with its own operator keys, binary file and key-rotation exercise; PR #22 and independent PR #10 merge-tested.
**P3-B3 verified — local approval-service isolation (restricted, read-only):**
- [x] Run an operator approval gateway as its own Linux Unix-socket process with kernel SO_PEERCRED allowlist, a private 0700 workspace/0600 socket, host-only policy/secret/registry files, strict bounded RPC and explicit preview/prepare/approve/execute/revoke.
- [x] Host server enforces signed Ed25519 operator intent and current host grants without accepting key/image/policy/path overrides from the caller; no model self-granting.
- [x] Actual out-of-process Unix service, offline operator-signer subprocess and Docker read tested; false signatures, forged privileged fields, revoked keys and unauthorized peer UIDs fail closed.
- [x] ProtocolIA PR #24 merged with green source CI; external ProtocolIA-Test PR #11 validates its own host/process, binary file and signature independently.

**P3-B4 verified — durable provider-independent budget ledger (NOT paid provider execution):**
- [x] Integer micro-USD HMAC-authorized worst-case quote, atomic scope ceiling and concurrent reservations before tool start. No double-reserving a reused operation ID.
- [x] Provider start is durably journaled; started/ambiguous reservations cannot auto-retry or be refunded on a guessed timeout.
- [x] Trusted signed usage evidence settles actual amount at or below reserved budget; forgery, unknown cost, overrun, duplicate receipts and changed ceilings are denied.
- [x] Independent consumer proves concurrent budget ceiling and deterministic signed settlement on disposable values; no actual paid provider or billing verified.
**Remaining P3-B2 before issue #4 closure:**
- [ ] Deploy independent actual-human enrollment/login/MFA (OIDC/WebAuthn or equivalent) and production approval UI. P3-B3 offers only local OS peer isolation plus offline operator Ed25519 key-possession proof; not a deployed human identity provider.
- [ ] Add a durable outbox and recoverable/compensatable effects before enabling any external writes or paid tools; handle crash, cancellation, partial commit and bounded retries.
- [ ] Wire cost reservations, provider receipts and verified settlement into at least one actual paid tool adapter under a host approval boundary; P3-B4 has proven the durable ledger itself but has NOT exercised real provider usage.
- [ ] Independently test hostile container/daemon escapes and host sandbox boundaries, including seccomp/user namespaces, races and resource leak behavior.
- [ ] Any multi-effect plan requires proven external partial-failure semantics; v0.5 deliberately permits only one external read.
**Exit for P3-A:** a provider-free, fully audited local DAG operates against only its allowed SQLite resources; no OS sandbox or external privileges claimed.

**Exit for full P3:** trusted plan integration, authenticated and revocable privileged grants, genuine writable/paid effect recovery and cost reservations, and independent adversarial sandbox verification are all required. This is NOT established by the single read-only v0.5 Docker broker. Keep issue #4 OPEN until these evidence gates pass.

### P4 — Subscription-authenticated Codex/Claude CLI A/B/C study (issue #5)

**Status: IN PROGRESS — PILOT INFRASTRUCTURE VERIFIED, ZERO MODEL SESSIONS SO FAR.** All study execution must use an already-authenticated Codex or Claude Code CLI under the user's subscription, never require API keys, paid model API calls or an SDK. See [P4 CLI study runbook](P4-SUBSCRIPTION-CLI.md) and [local execution guide](P4-LOCAL-RUNNER.md).

**Purpose:** prove a measurable benefit over **both** direct agents and ordinary generators.

**Three arms**
- **A:** coding agent implements a task directly.
- **B:** the same class of agent uses existing templates / OpenAPI generators, *without* ProtocolIA.
- **C:** agent proposes ProtocolIA contract → deterministic compile/generate → agent repairs only unsupported or failed work.

**Deliverables**
- [x] Provider-free benchmark packet/metadata interface for authenticated Codex and Claude Code CLI; no model SDK, API keys or automatic model calls, strict repair/time/intervention budgets. (No authenticated CLI sessions executed yet.)
- [x] Freeze two separate initial Codex/Claude pilot protocols with deterministic counterbalanced A/B/C order, 3 repeats, independent task/verifier commit and SHA256-pinned external task specs before viewing any comparative scores. Model/CLI version is recorded on each actual trial; those sessions remain pending.
- [ ] Complete full task coverage: initial frozen pilot provides CRUD, quota/domain invariants, contract evolution and hostile payloads; genuine seeded brownfield, ambiguous prompts and non-repetitive algorithms remain.
- [x] Pilot recorder parses Codex JSONL or Claude JSON, captures observed token counters or explicit null, CLI/model version, wall time, repairs/interventions and independent verifier evidence; never stores raw transcripts in results. Subscription incremental USD stays unknown, not $0, and Claude API-equivalent cost is labeled NOT billed.
- [x] Offline/provider-free preflight and negative grader validation with 95% Wilson intervals, missing-trial tracking and no automatic winner. [x] One-shot local CLI runner now implements frozen task import, explicit subscription-quota consent, pinned requested model, process-group timeouts, private traces and clean independent grader invocation. [ ] Run REAL subscribed CLI experiments and review matched outcomes.
- [ ] Independent tests/reviewers judge semantic correctness and security. Publish failures, negative results, protocol deviations and raw reproducible evidence.

**Primary metric for already-paid subscriptions:** independently verified success rate by arm, task and CLI (with Wilson uncertainty); secondary wall-clock time per success and observed CLI token counts, if available. **Do not fabricate marginal USD costs** for subscription access. The original dollar-per-verified-success objective is only evaluable for genuinely metered, independently attributable spend and must remain explicitly unavailable here. Verifier labor, repair count, reproducibility and safety remain tracked.

**Decision:** prefer C only if it credibly improves cost per successful mission on selected recurring tasks **against both A and B** with no unacceptable correctness/security degradation. Use **20% improvement** as an initial *research target*, not an unconditional pass threshold. If B is indistinguishable or better, reuse B and halt ProtocolIA's extra complexity for that task class.

**Exit:** authenticated CLI tasks actually performed in each arm, independently reproducible reports and reviewed negative/positive outcomes. A frozen but empty study **does not complete P4**, and no generic token/cost saving claim is allowed.

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
