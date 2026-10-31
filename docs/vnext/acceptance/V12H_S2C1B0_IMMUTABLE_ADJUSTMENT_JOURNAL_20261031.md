# S2c-1b0 — reviewed immutable signed adjustment journal (schema + reconciliation foundation)

Frozen 2026-10-31. Base `main` at `3677836c`, after dual-engine S2c-1a acceptance. Issue #57 remains OPEN.

## Authoritative policy and boundaries

The 1–20 original `ChargeLine` rows remain **immutable**. A business-authorized correction will be a new, append-only *signed delta* (positive for additional work, negative for a discount/approved correction) in a distinct `protocolia_exact_adjustment` relation. Its public request eventually needs an immutable adjustment ID (idempotency), actor from authentication, reason (12–240 characters), exact signed amount (nonzero), server timestamp, parent identity, explicit independent write capability and an audit record. **Never** use a generic parent money PATCH or replace the original charge rows.

## This bounded submilestone (S2c-1b0)

- Add an explicit `@reconcileExact(..., adjustmentJournal=true)` opt-in, restricted to a source-bound, lifecycle-enabled, `adjustmentPreview=true` itemized contract with immutable charge rows and a declared max exact total. Reject unsafe decorators in the TypeSpec compiler **and** shared adapter preflight. No unreviewed dynamic SQL.
- Both NestJS and modular Spring generators emit an identical, typed fixed-precision signed `protocolia_exact_adjustment` journal with parent foreign key (RESTRICT), unique per-parent immutable adjustment identity, reason/actor/creation timestamp and bound checked nonzero signed delta. A database trigger rejects UPDATE and DELETE by application credentials. No ordinary HTTP route exposes this table.
- Reconciliation must verify in **one PostgreSQL snapshot**: original itemized amount SUM + persisted signed adjustment SUM = the parent authoritative total, parent opening equals that total, parent available equals opening minus posted receipts, original charge count remains 1–20, adjustment count stays within 0–100. Report `balanced=false` and `coverageState=inconsistent` when any part drifts. Decrease/increase preview remains advisory and respects 100-adjustment exhaustion.
- The present receipt/reversal write path still locks parent then reads a fresh snapshot; must reject any mismatch HTTP 409 with no new receipt, reversal or audit.
- Verify both generated apps with **actual isolated PostgreSQL + HTTP + Chromium**: starting with no adjustments, injected adjustment-only drift blocks receipts; database rejects UPDATE/DELETE of journal rows; simulate an **explicit test-only atomic signed correction** through privileged fixture SQL (not application HTTP) and demonstrate correct exact read/posted calculations; 20 original lines and prior 10-way 3/7 concurrency, source-drift and full legacy financial regressions remain green.
- **Do not introduce a new monetary HTTP mutation in this PR**. Rehearsal SQL is test-only, not a production integration instruction. S2c-1b1 will add the reviewed TypeSpec adjustment POST operation, actor/permission, idempotency, reason, fresh lock/recheck, bounded exact signed money, 409 conflict, transactional append/update/audit, mobile confirmation, and explicit no-refund policy: negative delta cannot reduce total below internally posted receipts; external provider settlement and legal credit notes are separate milestones.
- Prevent an out-of-band actor from writing directly remains a production DB role/privilege control. An owner/admin can drop the immutability trigger; do not claim tamper-proof storage or signed external settlement.

No stable finance tag, no production deployment, and do not close TL-14/#57.
