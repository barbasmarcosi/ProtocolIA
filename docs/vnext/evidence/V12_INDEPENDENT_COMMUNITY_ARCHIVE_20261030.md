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

## v1.2b — Frozen customer-style black-box rubric (2026-10-30)

The **12 scenario specifications were committed before writing the test code** in [COMMUNITY_ARCHIVE_BLACKBOX_RUBRIC.md](../acceptance/COMMUNITY_ARCHIVE_BLACKBOX_RUBRIC.md). They reflect hypothetical operator requirements, **not independent external-customer signoff**. The probe invokes concrete ArchiveRoom/RecordBox HTTP routes and real browser interactions directly rather than relying on the IR/manifest to tell it what must work.

**Authoritative real Docker/PostgreSQL/Chromium matrix [#41001733630](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41001733630): SUCCESS on both targets at functional SHA `e4dfb6d65c298dda70110cbd816fa043facd721c`.**

| Gate | Spring Boot | NestJS |
| --- | --- | --- |
| CA-01...CA-04: mobile room/box create, duplicate 409, missing parent 400 | **4/4 PASS** | **4/4 PASS** |
| CA-05...CA-06: unsaved draft recovery/no POST, description UI patch | **2/2 PASS** | **2/2 PASS** |
| CA-07...CA-09: ten concurrent exact increments, invalid increment, FK-restricted deletion | **3/3 PASS** | **3/3 PASS** |
| CA-10...CA-12: reader UI+HTTP isolation, refresh persistence, JS errors | **3/3 PASS** | **3/3 PASS** |
| **Total** | **12/12 PASS** | **12/12 PASS** |

Observed logs in both jobs: twelve distinct `PROTOCOLIA_V12_BLACKBOX_CASE_PASS CA-nn` markers followed by `PROTOCOLIA_V12_BLACKBOX_CUSTOMER_RUBRIC_PASS` and `PROTOCOLIA_V12_COMMUNITY_ARCHIVE_MOBILE_CHROMIUM_PASS`. Final digitized-page count `14` from initial `4`, with all ten parallel requests successful, no lost updates and `browserErrors=0`. Both final screenshot SHA-256 hashes: `2d243a14103d11a7cb80634ed73fe662d580c422a102ff12ed4d8d77b7e960ef`. Node/TypeSpec/Spring/Nest React builds and disposable Compose database tests also passed. General code quality [#41001733612](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41001733612) and [#41001740639](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41001740639): **SUCCESS** on that functional SHA.

**Debugging record:** earlier run [#41001398422](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41001398422) had Spring 12/12 PASS and Nest CA-01...CA-10 PASS, then a CA-11 timeout after browser refresh. The probe read the login/navigation elements before asynchronous React hydration completed. At `e4dfb6d` it waits for auth/navigation readiness and reauthenticates only as necessary. It does **not** waive refresh persistence; the same CA-11 and all twelve conditions passed against Nest and Spring on the new run. This is a test synchronization correction, not evidence of a backend data-loss bug.

**Classification:** **v1.2b independent customer-style scenario oracle: SCOPED PASS ×2**, still **NOT** externally user-signed acceptance or production certification. The rubric remains fixed; any future test change should be explained as an explicit versioned amendment.

## Remaining gates

- **Generated mobile Chromium UI:** **PASS ×2** for manager creation/related record picker and reader isolation. The identical screenshots' SHA-256 is `0debb52f6d3603c2b55600395299eb11e2f3555877eefdf068f481ddf3a8e254`. Keyboard-only accessibility, screen readers, desktop regression and a broader responsive audit remain OPEN.
- **Independent customer-style black-box oracle:** **PASS ×2 for 12 predefined scenarios** after this v1.2b extension. Genuine independent customer-authored requirements/signoff remain **NOT RUN**; this rubric was written by the project.
- **Permission enforcement by row/tenant/owner, production OIDC, backup/restore of actual customer data, arbitrary contract semantics, accessible UX and hosted uptime:** NOT VERIFIED by this test. No deploy/merge authorized.

**Classification: v1.2a greenfield API/DB/UI generation PASS ×2 and v1.2b twelve-scenario business black-box evaluation PASS ×2; external customer acceptance and production criteria remain OPEN.**
