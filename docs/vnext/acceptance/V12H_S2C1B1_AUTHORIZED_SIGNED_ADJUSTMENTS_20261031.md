# S2c-1b1 — authorized signed adjustments, HTTP/transaction boundary

Frozen 2026-10-31. Base: S2c-1b0 `447eb6c1`; issue #57 OPEN.

## Contract and authority

A reviewed source-backed `@reconcileExact(..., adjustmentJournal=true)` allows exactly **one** `@behavior("adjustExact",parent)` operation on the same parent, with `POST /api/<parents>/{publicIdentity}/adjustments`, 201/400/401/403/404/409, exact request `{adjustmentId:string (8..64), delta:encoded exact decimal signed (matching parent 14,2 bound), reason:string (12..240)}`, and a parent response. The API capability MUST be a dedicated nonpublic `orders.adjust`, different from parent read, create/write and audit read. Neither actor nor parent identity nor authoritative totals can be client-supplied. Ignore any browser preview as a write token.

## Financial invariant

The server takes an authenticated actor from the verified session, validates exact wire decimal **without binary float** (nonzero), and locks the parent row before a new `READ COMMITTED` reconciliation. It rejects source or receipt drift, journal count >=100, original row count >=20, missing parent, duplicate ID and all invalid wire, reason and unauthorized requests. Negative corrections are permitted only where both `new opening >= posted receipts` **and** `new available >=0`; no refund is simulated or posted. Positive adjustments must not exceed the source-declared precision/max, never silently clamp or round. The entire journal INSERT, parent charge/opening/available adjustment and actor/reason/audit must commit or roll back as one PostgreSQL transaction. The original ChargeLine rows and Payment rows must remain unchanged.

## Acceptance

- Independent generated NestJS and modular Spring real isolated PostgreSQL/HTTP: +0.20, -0.10, zero/overflow/wire-negative mistakes, blank reason, forged actor/amount/parent, nonexistent parent, duplicate adjustment ID, impersonation/reader 403, stale journal/receipt 409, repeated adjustment, and close/covered policy. Concurrency: multiple requests racing for a single available amount must never produce negative available or duplicate adjustment IDs; **assert deterministic authorized outcomes** and post-write source/journal reconciliation.
- Confirm immutable journal still rejects UPDATE/DELETE even after authorized append; keep old direct child mutation sealed and original charge rows unchanged.
- Run previous 10-way 3/7 payment acceptance, S2b/S2c itemized, mobile Chromium existing UI, and legacy finance in both targets, plus five quality jobs.
- The generated React mobile preview remains **read-only in this submilestone**: no unreviewed write shortcut; follow-up needs an explicit safe UX confirmation and independent human usability review.

**Exclusions:** tax/discount invoice legal policy, external bank/card settlements, legal refund/credit note, cross-tenant IAM, credential rotations, production backups, and financial certification. A correction isn't a legal credit note. Never close TL-14/#57 or stable-tag finance based on this.
