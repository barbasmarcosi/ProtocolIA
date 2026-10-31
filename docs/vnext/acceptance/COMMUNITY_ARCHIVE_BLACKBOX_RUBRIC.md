# CommunityArchive — independent black-box business acceptance rubric (v1.2b)

**Frozen specification date:** 2026-10-30. Authored from a hypothetical community archive operator's needs, **not an actual external customer's signed requirements**. This is a test oracle deliberately independent of the generated app's IR, operations manifest, SQL implementation and adapter internals. Fix the rubric before changing the probe. Initial stage: two generated backends, one fresh disposable PostgreSQL instance each, real Chromium, no external network or production systems.

## Context and user roles

An archive operator stores historical documents in physical rooms. Each numbered box belongs to one room. Volunteers digitize pages in batches. A reader can consult but cannot create or mutate records. A room that still has boxes must not be deleted.

## User-observable acceptance cases

| ID | User demand | Independent observable outcome |
| --- | --- | --- |
| CA-01 | Register room from mobile | Manager logs in at 390×844 and creates ROOM-A1; persisted GET yields correct label |
| CA-02 | Duplicate identifiers blocked | POST room ROOM-A1 again returns 409; original data unchanged |
| CA-03 | Create box with selected room | Manager creates BOX-A1 from generated mobile picker; GET yields exact reference, roomCode, description, 4 digitized pages |
| CA-04 | Foreign references validated | Direct POST box referencing missing room returns 400; no orphan persists |
| CA-05 | Prevent accidental loss of a partially filled draft | Opening and cancelling a dirty new-box form prompts; choosing continue editing retains form contents and sends no POST |
| CA-06 | Correct existing description | UI edits BOX-A1 description; authenticated GET returns new exact text, unchanged room and digitized count |
| CA-07 | Volunteer increments never disappear | Ten simultaneous authorized HTTP increments of one page each all succeed and final count advances by exactly ten |
| CA-08 | Invalid increments cannot change data | Zero increment returns 400; final count unchanged |
| CA-09 | Occupied room cannot be deleted | Deleting ROOM-A1 while BOX-A1 references it is rejected, existing room and box unchanged |
| CA-10 | Reader cannot write | Reader cannot see create/patch/increment UI; direct reader POST and PATCH both 403; existing data unchanged |
| CA-11 | Server state survives navigation and reload | Refresh reader screen: BOX-A1 and updated description remain visible |
| CA-12 | No uncaught JS errors in mobile workflow | Chromium pageerror count exactly zero, screenshot digest logged for diagnosis |

**All 12 are required** for a scoped PASS in each target. Any failed case is FAIL (not silently skipped); if the test cannot execute, NOT RUN. Evaluate each target independently. A green generic `app:test` does **not** substitute for these explicit customer operations. No manual edits of generated service, UI or SQL permitted.

## Intentionally separate / open

Cross-tenant/record-level IAM, full audit trail, bulk import/export, backup/restore, accessible keyboard-only audit, desktop layouts, real SSO, deploy uptime and production backup are not covered by these 12. This rubric remains a project-authored simulation, so it is **not** independent external-customer sign-off.

## Traceability

- Contract: `examples/vnext/community-archive/contracts/main.tsp`.
- Oracle: `scripts/vnext/probe-independent-browser.mjs` (direct URLs and user-facing UI; must not read generated manifest for its business expectations).
- Runner: `.github/workflows/v12-independent-contract-acceptance.yml` for both modular Spring and NestJS, generated cleanly from TypeSpec.
- Results: write exact run ID, target, observed case markers and any limits to `docs/vnext/evidence/V12_INDEPENDENT_COMMUNITY_ARCHIVE_20261030.md` **only after CI finishes**.
