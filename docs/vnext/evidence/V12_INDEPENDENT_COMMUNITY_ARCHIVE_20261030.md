# v1.2a — Independent CommunityArchive TypeSpec-to-working-application acceptance

**Date:** 2026-10-30 UTC. **Base:** unreleased Draft v1.1 PR #55; `main` and `v1.0.0` unchanged. This is an additional acceptance case, not a retroactive change to the historic A13 score.

## Independent business domain

`examples/vnext/community-archive/contracts/main.tsp` declares two entities which were not in the prior historical example set:
- `ArchiveRoom`, with `roomCode` public identity and required label.
- `RecordBox`, with `reference` public identity, required `roomCode → ArchiveRoom` foreign key (restrict), description, nonnegative `pagesDigitized` and optional-null UTC review timestamp.

All 10 declared business operations are standard compiler-supported semantics: two CRUD sets, record-box text PATCH and bounded atomic scanned-page increment. There are no domain-specific Java, Nest, React, PostgreSQL or HTML source files. Existing source generators and the stock CLI operate on this new TypeSpec contract without edits.

## Real observed acceptance

**Public [GitHub Actions matrix #41000626735](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41000626735): SUCCESS on both NestJS and modular Spring Boot** (supersedes the first HTTP-only green run [#41000241366](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41000241366)). The two CI jobs each completed:
1. Node 24 `npm ci`, official TypeSpec and OpenAPI compilation, generated backend and React builds from the identical TypeSpec project.
2. Source-owned manifest/IR gate `scripts/vnext/probe-independent-contract-build.mjs`: identical IR digest `12ae06e53aaf801753db1d3d9a46329f86594440b4446e9dbe81e971bb24e109` for Spring/Nest; `resources=2`, `operations=10`, FK and public identity preserved.
3. `npm run app:test -- <generated>`: isolated, randomly named Docker Compose and real PostgreSQL, generated HTTP health, create/read/list/update/delete, duplicate and invalid inputs, enforced reader/writer permissions, FK restriction and 10-way atomic increment without lost updates, followed by disposable-volume cleanup. No connection to deployed app or user data.
4. A **second isolated Compose project per target**, plus pinned Playwright 1.56.1 and real Chromium 390×844. The manager logs into generated React, creates an `ArchiveRoom`, navigates to `RecordBox`, chooses the parent through the generated FK picker, creates a record, and proves its persisted values via authenticated HTTP. The reader can see the new row but no create action; a direct reader POST returns 403. Uncaught browser JavaScript errors: **0**.

Observed exact markers, **each on both targets**:
- `PROTOCOLIA_V12_INDEPENDENT_CONTRACT_GENERATION_PASS`
- `PROTOCOLIA_COMPOSE_HEALTH_PASS`
- `PROTOCOLIA_MULTIRESOURCE_CONFORMANCE_PASS {"entities":["ArchiveRoom","RecordBox"],"references":["RecordBox.roomCode->ArchiveRoom"]}`
- `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`
- `PROTOCOLIA_V12_COMMUNITY_ARCHIVE_MOBILE_CHROMIUM_PASS` (both generated targets, `relatedRecordCreated=true`, `serverReadMatchesUi=true`, `readerWriteDenied=true`, `pageErrors=0`)

The standard `quality` workflow also completed SUCCESS on the first source revision: [#41000241271](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41000241271).

## Remaining gates

- **Generated mobile Chromium UI:** **PASS ×2** for manager creation/related record picker and reader isolation. The identical screenshots' SHA-256 is `0debb52f6d3603c2b55600395299eb11e2f3555877eefdf068f481ddf3a8e254`. Keyboard-only accessibility, screen readers, desktop regression and a broader responsive audit remain OPEN.
- **Customer-driven acceptance independent of ProtocolIA's own oracle:** NOT RUN. This first slice uses a fresh contract but reuses the generic engine-owned conformance tests; an external rubric/black-box evaluation is still needed.
- **Permission enforcement by row/tenant/owner, production OIDC, backup/restore of actual customer data, arbitrary contract semantics, accessible UX and hosted uptime:** NOT VERIFIED by this test. No deploy/merge authorized.

**Classification: v1.2a supported greenfield TypeSpec → API/DB/React mobile functional acceptance BOUNDED PASS ×2; genuinely external customer-driven black-box scoring and production criteria remain OPEN.**
