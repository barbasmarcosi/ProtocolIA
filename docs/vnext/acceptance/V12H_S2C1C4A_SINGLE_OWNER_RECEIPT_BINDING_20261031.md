# S2c-1c4a — one immutable provider candidate per receipt (sandbox)

Date: 2026-10-31. Base `main` `96e72b4480daa01d46f960161ef5aae3ff1ec699`. TL-14 / issue #57 stays open.

## Security invariant

A signed `receipt-candidate.v1` event is an initial association of a synthetic provider envelope with one exact, posted internal receipt. It is **not** a lifecycle update or independent proof of bank settlement. Previously, different event IDs or different provider identities could create multiple independent candidate rows for the same receipt. A future settlement processor could incorrectly treat those as separate financial evidence.

For the **v1 candidate contract only**, a receipt can have **at most one** immutable candidate across all providers and event IDs. Later provider lifecycle observations, when implemented, must reference this existing binding through a separately versioned, authenticated contract rather than create another candidate.

- PostgreSQL enforces `UNIQUE(receipt_id)` on `protocolia_provider_receipt_candidate`, in addition to the existing `PRIMARY KEY(provider_id,event_id)` and append-only triggers.
- The existing `SELECT ... FOR UPDATE` receipt lock serializes competing first-time claims. After exact order, amount, posted and unverified checks, the SQL function checks for an existing binding **before** writing any new envelope. A second claim returns `conflict` (HTTP 409) and leaves no inbox/candidate fragment.
- Identical replay of the original `(provider,event_id,digest,receipt,order,amount)` still returns `duplicate` (HTTP 200), including after an authorized synthetic receipt reversal; a changed digest/claim remains a conflict.
- No receipt balance, audit, `provider_settlement_state` or external financial state is changed. Provider identity remains server-pinned and the signed sandbox ingress remains disabled by default.

## Executable acceptance

The existing `.github/workflows/v12h-s2c1c0-provider-envelope.yml` matrix builds **independent NestJS and Spring** applications from the same TypeSpec contract and executes:

1. `node --test tests/vnext/provider-envelope-inbox.test.mjs`: canonical SQL must contain unique receipt binding and a fail-closed pre-inbox check.
2. `node scripts/vnext/probe-provider-inbox.mjs <generated-app>`: disposable real PostgreSQL, ten concurrent **different event IDs** racing to claim a fresh receipt must yield exactly **one stored / nine conflicts**. Same-provider and cross-provider second claims must fail with zero new envelope rows. Original same-event ten-way idempotency, rollback, reversal replay, immutability and exact amount regressions remain mandatory.
3. `node scripts/vnext/probe-provider-http.mjs <generated-app>`: signed HMAC sandbox HTTP second-event claim must return HTTP 409 with zero new inbox rows; original event remains HTTP 200 on replay.

All money and events in these tests are synthetic. CI outcome must be verified on the final PR SHA; this document is not itself evidence of a passing run.

## Not implemented

This is a **prerequisite** to S2c-1c4, not the external settlement state machine. Provider-specific authority, event ordering, independently verified clearing, refunds, chargebacks, production IAM/tenancy, tax/invoicing, backups and independent customer acceptance remain open. No production deployment, real provider transaction or stable financial release is permitted.
