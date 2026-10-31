# S2c-1c3c — stable signed receipt-candidate replay after reversal

Date: 2026-10-31. Base `main` `70ca99656119d6bb8d0fe679dc6817ddcf82573f`. Issue #57 (TL-14) remains OPEN.

## Reproducible defect and bounded fix

A provider's signed receipt candidate can commit in PostgreSQL while its HTTP 202 response is lost. If an authorized operator later reverses that receipt, an identical retry previously received HTTP 409 because the mutable `posted` check ran before historical event deduplication. That is not deterministic recovery of an already committed event.

The canonical, framework-neutral SQL generator now first checks the append-only provider envelope using `SELECT ... FOR UPDATE`. A matching digest and immutable receipt/order/amount candidate return `duplicate` without relying on current receipt state. Changed digests, changed claims and digest-only unbound events return `conflict`. For a previously unseen event, the existing locked-receipt validation still requires `posted` and `unverified`. No provider event may modify a receipt, balance or settlement proof.

The lock waits for a concurrent committed inbox row when visible. First-delivery concurrency continues to use the unique `(provider_id,event_id)` key and atomic candidate write. No signing key identifier is included in replay identity.

## Executable regression oracles

The provider CI matrix regenerates both independent targets from `examples/vnext/workshop-itemized-guard` and runs:

- `node --test tests/vnext/provider-envelope-inbox.test.mjs` for SQL ordering and immutable binding.
- `node scripts/vnext/probe-provider-inbox.mjs <generated-app>` against disposable PostgreSQL. It records a candidate, simulates a synthetic reversal with matching exact balance update, then requires identical replay `duplicate`, changed digest `conflict`, and a new event `mismatch` without additional inbox rows.
- `node scripts/vnext/probe-provider-http.mjs <generated-app>` against real generated HTTP/PostgreSQL. After synthetic reversal, identical signed retry must return HTTP 200; a new signed event must return HTTP 409. The original candidate remains one row, and the provider proof remains `unverified`.

These tests are synthetic and do not authorize external settlement or real financial processing.

## Evidence status

CI results must be checked on the final PR SHA before merge. This document is a reproducible acceptance specification, not a claim of completed verification.

## Remaining TL-14 blockers

Independently authorized provider settlement state transitions, out-of-order event ordering, refund/chargeback lifecycle, production provider-specific credentials and trust, tenancy/IAM, retention/backup, legal tax/invoice policy and independent business acceptance. Do not close #57, deploy production or publish a stable financial tag.
