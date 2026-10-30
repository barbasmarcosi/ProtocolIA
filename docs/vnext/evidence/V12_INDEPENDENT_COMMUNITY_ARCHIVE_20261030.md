# v1.2a — Independent CommunityArchive TypeSpec-to-working-application acceptance

**Date:** 2026-10-30 UTC. **Base:** unreleased Draft v1.1 PR #55; `main` and `v1.0.0` unchanged. This is an additional acceptance case, not a retroactive change to the historic A13 score.

## Independent business domain

`examples/vnext/community-archive/contracts/main.tsp` declares two entities which were not in the prior historical example set:
- `ArchiveRoom`, with `roomCode` public identity and required label.
- `RecordBox`, with `reference` public identity, required `roomCode → ArchiveRoom` foreign key (restrict), description, nonnegative `pagesDigitized` and optional-null UTC review timestamp.

All 10 declared business operations are standard compiler-supported semantics: two CRUD sets, record-box text PATCH and bounded atomic scanned-page increment. There are no domain-specific Java, Nest, React, PostgreSQL or HTML source files. Existing source generators and the stock CLI operate on this new TypeSpec contract without edits.

## Real observed acceptance

**Public [GitHub Actions matrix #41000241366](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41000241366): SUCCESS on both NestJS and modular Spring Boot**. The two CI jobs each completed:
1. Node 24 `npm ci`, official TypeSpec and OpenAPI compilation, generated backend and React builds from the identical TypeSpec project.
2. Source-owned manifest/IR gate `scripts/vnext/probe-independent-contract-build.mjs`: identical IR digest `12ae06e53aaf801753db1d3d9a46329f86594440b4446e9dbe81e971bb24e109` for Spring/Nest; `resources=2`, `operations=10`, FK and public identity preserved.
3. `npm run app:test -- <generated>`: isolated, randomly named Docker Compose and real PostgreSQL, generated HTTP health, create/read/list/update/delete, duplicate and invalid inputs, enforced reader/writer permissions, FK restriction and 10-way atomic increment without lost updates, followed by disposable-volume cleanup. No connection to deployed app or user data.

Observed exact markers, **each on both targets**:
- `PROTOCOLIA_V12_INDEPENDENT_CONTRACT_GENERATION_PASS`
- `PROTOCOLIA_COMPOSE_HEALTH_PASS`
- `PROTOCOLIA_MULTIRESOURCE_CONFORMANCE_PASS {"entities":["ArchiveRoom","RecordBox"],"references":["RecordBox.roomCode->ArchiveRoom"]}`
- `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`

The standard `quality` workflow also completed SUCCESS on the first source revision: [#41000241271](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41000241271).

## Remaining gates

- **Generated responsive Chromium UI and workflow-level browser creation:** NOT RUN for this fresh independent project. Generating React is not equivalent to proving a mobile browser journey.
- **Customer-driven acceptance independent of ProtocolIA's own oracle:** NOT RUN. This first slice uses a fresh contract but reuses the generic engine-owned conformance tests; an external rubric/black-box evaluation is still needed.
- **Permission enforcement by row/tenant/owner, production OIDC, backup/restore of actual customer data, arbitrary contract semantics, accessible UX and hosted uptime:** NOT VERIFIED by this test. No deploy/merge authorized.

**Classification: v1.2a supported greenfield API/DB contract generation BOUNDED PASS ×2; full independent customer product acceptance remains OPEN.**
