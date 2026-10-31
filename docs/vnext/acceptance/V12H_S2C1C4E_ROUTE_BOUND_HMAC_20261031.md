# S2c-1c4e — purpose-bound HMAC for synthetic provider HTTP

Base `main`: `7cde934a5c95ff000bb290c1cf0f912c2bbed6b0`. TL-14/#57 stays OPEN.

## Security increment

Previously v1 signed the event ID and raw body but not the destination route: a captured valid candidate/lifecycle request could be replayed into the generic inbox to consume the immutable (provider,event) identity before its intended request. Both independent generators now require v2 domain separation, with the purpose chosen on the server: `inbox`, `receipt-candidate`, or `lifecycle-observation`. The exact HMAC-SHA256 input is `protocolia-provider-proof-v2\\n{purpose}\\n{keyId}\\n{unixSeconds}\\n{eventId}\\n` followed by the original bytes. Header is `v2=<lowercase hex>`. v1 is rejected. This is a deliberate breaking change **only to disabled-by-default synthetic/demo endpoints**; not a bank provider protocol.

## Required acceptance

The existing two-target provider workflow runs Node and Java frozen HMAC fixtures, invalid purpose/v1/tamper/expiry tests, real PostgreSQL and HTTP probes. Cross-route signed requests must return HTTP 401 **without an inbox row**. Existing 10-way idempotency, out-of-order 3→1→2, rollback and exact ledger invariants remain mandatory. Inspect actual CI results before merge; no unverified PASS claims.

## Non-goals

No independent provider settlement authority, production provider credentials, actual refund/chargeback, tenant IAM, external reconciliation or financial operations. The fixed unverified proof field and synthetic causal projection are unchanged.
