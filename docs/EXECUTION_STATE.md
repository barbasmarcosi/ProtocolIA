# ProtocolIA — Execution State

Updated: 2026-10-10. **P0 and P1 are merged to main and independently verified.**

## Verified repository baselines

- ProtocolIA main: `5a4b5328671116909c209c7f0f9134d18a35d6af` — [quality run 38086078063](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38086078063): **success**.
- ProtocolIA-Test main: `3fa48d625b030d53dc0a2128d337ed62c64bc103` — [independent consumer run 38086134530](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38086134530): **success**.
- ProtocolIA merged PRs: [#1 (P0)](https://github.com/barbasmarcosi/ProtocolIA/pull/1), [#9 (P1-A)](https://github.com/barbasmarcosi/ProtocolIA/pull/9), [#10 (P1-B)](https://github.com/barbasmarcosi/ProtocolIA/pull/10), [#11 (P1-C)](https://github.com/barbasmarcosi/ProtocolIA/pull/11).
- Independent consumer merged PRs: [#1](https://github.com/barbasmarcosi/ProtocolIA-Test/pull/1), [#2](https://github.com/barbasmarcosi/ProtocolIA-Test/pull/2), [#3](https://github.com/barbasmarcosi/ProtocolIA-Test/pull/3), [#4](https://github.com/barbasmarcosi/ProtocolIA-Test/pull/4).

**SHA discipline:** the two main SHAs above are the *verified code-merger baselines*. This documentation-only update produces a newer ProtocolIA main commit; verify CI on the new exact SHA before stating that all checks on HEAD pass.

## Delivered gates

| Gate | State | Evidence / limits |
| --- | --- | --- |
| P0: deterministic compiler | COMPLETE | Python 3.11/3.13 installed CLI and golden v0.1 outputs, external OpenAPI/TS tools, independent consumer |
| P1-A: strict normative contract shape | COMPLETE | JSON Schema 2020-12 and differential structural/semantic corpus; independent inventory consumer |
| P1-B: conservative version-aware diff | COMPLETE | Deterministic additive/breaking diagnostics and CLI; independent consumer |
| P1-C: v0.2 reference runtime | COMPLETE | Bounded typed scalar constraints (numeric/string/enum/pattern), nested-model and array validation, generated JSON Schema/OpenAPI/TS, exact route parameter bindings, explicit migration and safe preview, negative/differential tests and independent consumer |

**P1 scope clarification:** This is a narrowly specified, provider-free *contract language and executable input-validation reference*, not a formal proof of business behavior. Runtime authentication enforcement, databases, transactional invariants, authorization, arbitrary predicates, generated FastAPI services, action IR, execution budgets, model integration, and measured token/USD savings are **not implemented**. Smithy/CUE interoperability was assessed in [ADR-001](ADR-001-MODELING-STANDARDS.md), but **import/export round-trip support is not claimed**. A separate immutable typed AST and wider interop work remain future architectural tasks, not verified P1 features.

## Next gate: P2 — generated, running service

1. Generate one bounded Java 21 / Spring Boot 4.x service from a v0.2 contract: Java records/DTOs, Spring MVC route bindings, Jakarta Bean Validation (with explicit runtime parity checks), and clearly unimplemented business-handler boundaries. Maven build/test. The Python ProtocolIA compiler remains unchanged.
2. Add independent end-to-end tests in ProtocolIA-Test with Spring Boot Test/JUnit 5 and Testcontainers PostgreSQL; compare runtime HTTP behavior to declared OpenAPI/JSON Schema, including negative and malformed payloads. Compare generated scaffolding against OpenAPI Generator's Spring generator baseline.
3. Introduce *one* supported named inventory-sale rule with Spring @Transactional/PostgreSQL semantics, race-safe stock decrement, PostgreSQL-backed negative/concurrency/idempotency tests, Spring Security authorization enforcement, rollback evidence and non-destructive Flyway migration previews. **Do not** equate a label such as `stock_must_not_be_negative` with an implemented rule.
4. Keep provider-free core and independent P1 regression gates; retain P4 preregistered A/B/C benchmarks as future research and never invent savings.

Issues: [P2 #3](https://github.com/barbasmarcosi/ProtocolIA/issues/3), [P3 #4](https://github.com/barbasmarcosi/ProtocolIA/issues/4), [P4 #5](https://github.com/barbasmarcosi/ProtocolIA/issues/5), [P5 #7](https://github.com/barbasmarcosi/ProtocolIA/issues/7), [P6 #8](https://github.com/barbasmarcosi/ProtocolIA/issues/8).

## Evidence contract

Treat `implemented`, `tested locally`, `passed CI on named SHA`, `passed independent consumer`, and `proved in a generated service` as different statuses. Do not promote one into another without new evidence. Published SHA-256 manifests are accidental change-detection metadata, not trusted cryptographic attestation or proof of domain correctness. No unrestricted tool execution or production writes.
