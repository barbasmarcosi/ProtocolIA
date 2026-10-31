# S2c-1c3a — exact receipt candidate correlation (database-only)

Date: 2026-10-31. Base `main` `ef692cd4e67e68b011b0fe2d72f20c0c76a159b3`. TL-14 / issue #57 remains OPEN.

## Functional scope

A canonical source-backed `@reconcileExact` with `unverifiedProofField` supplies validated child table, receipt identity, parent reference, amount, status, proof column and exact decimal bounds to both independent generators. A new immutable PostgreSQL `protocolia_provider_receipt_candidate` table links an existing provider envelope `(provider_id,event_id)` to one real receipt and an exact amount. It does **not** mark the receipt externally settled.

`protocolia_record_provider_receipt_candidate(provider,event,digest,receipt,order,amount)` holds a PostgreSQL row lock on the referenced receipt, checks its authoritative order, exact amount, posted status and `unverified` proof, and atomically records the envelope digest and candidate in the same transaction. A missing or mismatched receipt returns `missing`/`mismatch` with no inbox or candidate fragment. Duplicate event/digest/receipt/amount returns `duplicate`; conflicting digest or receipt claims return `conflict`. A previously stored *unbound* inbox digest cannot silently become a linked candidate. Both tables reject UPDATE/DELETE. The function refuses non-exact/negative/overflow amounts and unsupported canonical bindings.

The function is an **internal database primitive only**. It does not authenticate an external sender, parse a signed JSON event, expose an HTTP route, accept bank statements, change `payment.provider_settlement_state`, issue refunds or authorize production payment processing. The existing signed sandbox HTTP route still records envelope digests only. Calling this SQL function directly is not evidence of external provider authority.

## Executable acceptance

The existing provider workflow regenerates NestJS and modular Spring from the identical TypeSpec, runs generic PostgreSQL/HTTP conformance, HMAC cross-language vectors, inbox concurrency and HTTP replay tests. `scripts/vnext/probe-provider-inbox.mjs` now additionally creates a synthetic customer/vehicle/order/payment in the generated PostgreSQL schema, verifies exact receipt matching, 10 concurrent same-event requests (one stored/nine duplicates), changed digest and claims, no row on invalid/missing receipt, rollback-before-commit, append-only protections and unchanged internal money/proof state.

**Evidence status: VERIFIED on functional SHA `77ab19212ba9fd5e66c734fb2101848f952b06a6` (2026-10-31).**
- [Provider envelope + receipt candidate + signed HTTP #41207727225](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41207727225): SUCCESS NestJS and modular Spring; job logs contain `PROTOCOLIA_S2C1C3A_RECEIPT_CANDIDATE_PASS` for each independently generated target, 1 stored/9 duplicates, negative amounts, unbound and reversed receipt rejection, rollback and append-only enforcement. Existing signed HTTP sandbox regression also passed in both.
- [General quality #41207727244](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41207727244): SUCCESS.
- [Exact drift-safe receipts #41207727310](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41207727310): SUCCESS.
- [Immutable itemized finance #41207727246](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41207727246): SUCCESS NestJS and modular Spring.

These tests validate a database-only candidate, **not** an authenticated receipt-linked HTTP settlement. All test data are synthetic. No financial release or production deployment is approved.

## Next

S2c-1c3b must define a strict, versioned, provider-specific signed event schema, validate raw-body-derived claims, pin trusted provider authority and invoke the receipt-candidate function from a generated HTTP handler. Reject mismatched or unbound receipts before acknowledging processing. Even then, a separate reviewed settlement-state machine, durable recovery, refunds, chargebacks and independent provider acceptance remain required.
