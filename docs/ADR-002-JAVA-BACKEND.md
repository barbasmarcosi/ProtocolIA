# ADR-002 — First P2 target: Java / Spring Boot

**Status:** Proposed for first generated backend (2026-10-10); documentation-only decision, not implemented.

## Context

ProtocolIA P0/P1 are provider-free Python compiler layers emitting OpenAPI, TypeScript and JSON Schema. P2 needs a real backend to prove contracts compile into executable applications. The previously suggested FastAPI target was provisional, not a requirement. Java/Spring Boot is explicitly requested as a candidate.

## Proposed decision

- Keep the ProtocolIA compiler in Python, with backends behind a versioned generator interface.
- Make the **first executable target** Java 21, Spring Boot 4.x, Maven; pin exact versions when implementing and test against those versions.
- Generate Java DTOs/records, Spring MVC routes/controllers, Jakarta Bean Validation mapping, OpenAPI conformance tests and explicit unimplemented handler boundaries. Do not generate fake business success responses.
- Add PostgreSQL, carefully previewed migrations, Spring Security enforcement, and JUnit 5/Testcontainers tests for the inventory-sale transactional slice. No production writes or DDL by default.
- Preserve deterministic generation, manifest ownership, v0.1/v0.2 contract compatibility, fail-closed unsupported predicates, and no runtime model/provider dependencies.
- **Baseline B must include OpenAPI Generator's existing stable Spring server generator**, not just a direct coding agent. Reuse conventional generators where possible and measure ProtocolIA's additional utility in constraints, provenance, safe changes and verified business semantics.

## Tradeoffs and risks

- Advantages: static typing, mature backend ecosystem, well-supported validation/persistence/testing frameworks, and a strong proof of compiler independence from the output language.
- Costs: slower clean builds and heavier tooling than FastAPI, additional template/runtime/annotation parity risks, Jakarta/Spring Boot 4 compatibility and JPA concurrency pitfalls.
- Spring Security annotations, generated OpenAPI and DTO validation do not guarantee correct authorization or business rules; actual HTTP, transaction and adversarial tests are mandatory.
- Avoid treating `@Transactional` alone as proof of no overselling; use explicitly atomic SQL/update with verified isolation semantics and concurrent integration tests.

## P2 exit criteria

Fresh clone of ProtocolIA and ProtocolIA-Test: contract → deterministic generated Java sources → Maven clean verify → booted HTTP service → OpenAPI/JSON Schema/validation parity tests → PostgreSQL-backed transactional sale scenario (stock shortage, duplicates, concurrency and rollback), authorization negatives and regeneration safety. Demonstrate independent consumer tests and publish exact CI commit/run IDs. If ordinary OpenAPI Generator performs equivalently for a class of tasks, prefer reuse and report the negative comparison.

## Non-goals of this decision

Rewriting the compiler in Java, generating both FastAPI and Spring in P2, changing P1 grammar just to fit Spring annotations, or claiming that generated code is ready for production.
