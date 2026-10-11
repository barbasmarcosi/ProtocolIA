# Product-first plan (ProtocolIA)

**Decision — 2026-10-11:** pause expansion of P4. Preserve its frozen study and
three exploratory artifacts. An HTTP PASS on manually implemented shadow
controllers does not establish value for ProtocolIA.

## Goal

From one typed contract, generate a real Spring Boot API with records, routes,
validation, auth and *one* controller. The developer supplies only business rules
through a typed handler interface. Never invent domain transactions or claim
success from code that returns 501.

## Four steps, no research bureaucracy

1. **Use the output (active):** generate a typed ContractHandlers port, invoke
   it from the generated MVC adapter, and ship a catalog CRUD example. Test
   determinism, non-destructive regeneration, Maven clean verify and real HTTP.
2. **Make it reliable:** address real Spring Boot 4 defects and boundary cases
   exposed by the example (auth, validation, JSON strictness, error status,
   and supported response status). Maintain fail-closed unsupported semantics.
3. **Make it pleasant:** provide one clear generation/run flow; simplify repeated
   manual work only when it causes actual developer friction. Avoid parallel
   handwritten APIs.
4. **Decide whether it is valuable:** compare development and maintenance
   effort against direct code and existing generators with honest, measured
   successful tasks. If no concrete advantage appears, narrow or replace the
   approach rather than build additional benchmark ceremony.

## Exit policy

A stage is complete only with working executable output, tests that genuinely
run, and representative HTTP behavior. Track failures as engineering work and
fix them directly. Keep a single concise status here, rather than generating
multiple master plans. No paid APIs or changes to the frozen P4 protocol.

### Stage 1 state — COMPLETE (2026-10-11)

Generated Java target `java-spring/0.4` now emits typed
`ContractHandlers` and the one generated MVC controller delegates to the
implementer-owned bean. A missing bean preserves HTTP 501. The catalog
example implements domain semantics in one service class, not a second API.
Regeneration preserves custom code and rejects modified generated files.

**Observed evidence on Render Free** (no paid provider API or GitHub Actions):
- Branch code commit `786cc15159be88d79968f263da2f2561eafd3480`.
- Real pipeline: contract validation -> 11 generated files -> 7/7 Python
  generator unit tests -> Java 21, Maven 3.9.11 `clean verify` **BUILD SUCCESS**.
- JUnit/SpringBoot HTTP integration test: **1 run, 0 failures/errors**, covering
  public health, unauthenticated 401, create 201, read 200/404, duplicate 409
  without mutation, negative stock 400, whitespace 400, malformed JSON 400,
  unknown-property JSON 400.
- Executable JAR SHA-256:
  `71a824c40394ee58fb329d891e820c14aaef904a994d662bc896d7cb78957da5`.
- Render service `srv-db5v0tt9fdbs73e7fddg`, deploy
  `dep-db5v28ad0e5s738q8hh0`: **LIVE**. Independently requested
  `https://protocolia-product-catalog-dev.onrender.com/health` ->
  `{"status":"UP"}`.
- First Render attempt had a container-registry metadata stall; a Docker base
  digest pin resolved it. This was infra, not a failed generated application.

**Stage 2 — supported regeneration and access-control hardening (2026-10-11)**

- Contracts may **add or remove models and generated files** across successive
  java-spring/0.4 generations. Preflight verifies the hashes and paths of all
  previously owned files, rejects handwritten collisions, tampered manifests,
  modified generated files and symlinks; stale *owned* files alone are removed.
  Handwritten business services are never managed or deleted.
- The optional demonstration viewer receives only non-public capabilities
  attached to **GET operations with no write effect**. It is unable to create
  catalog records even with valid credentials.
- Real Render evidence (separate disposable **Free** service
  srv-db5v9ovlk1mc73bc45fg): **12/12 Python generator tests PASS**,
  **4/4 inventory-template regression tests PASS** and **1 Java 21/Spring Boot 4
  end-to-end HTTP test PASS**, including a viewer read-200 / write-403 check.
  Maven clean verify **BUILD SUCCESS** without skipping tests. Java artifact
  SHA-256: ec2c9032bb1617f3298228f62458eb23b9519cbfc6b208e0e2ea9177ba2ebca5.
- This is a practical **incremental milestone within Step 2**, not a claim of
  comprehensive Java semantics. Unknown JSON properties/invalid JSON remain
  400 in the sample; POST uses target-level HTTP 201 convention because v0.2
  contracts do not declare per-operation success codes.

Known limits: an **old java-spring/0.3 ownership manifest cannot be silently
upgraded in place**: use a new output directory and consciously migrate custom
code. Multi-file regeneration checks all ownership before writing and updates
the manifest last, but cannot promise an atomic transaction against a sudden
process/filesystem failure. Optional/null and enum model support still fail
closed. Demo Basic authentication is not production identity.

**Next:** Step 3 — reduce repeat manual setup and improve developer experience
with the smallest useful command, while retaining honest regeneration errors.
