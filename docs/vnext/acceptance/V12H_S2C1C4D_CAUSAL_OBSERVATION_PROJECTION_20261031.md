# S2c-1c4d — read-only causal integrity of synthetic provider observations

Date: 2026-10-31. Base `main`: `515d6ce186876173562d7428ec08ba2f132594ed`. Issue [#57](https://github.com/barbasmarcosi/ProtocolIA/issues/57) remains **OPEN**.

## Functional change

The canonical provider-candidate binding now generates the same PostgreSQL **read-only** function in NestJS and modular Spring:

```sql
SELECT causal_integrity, last_coherent_phase, observation_count
FROM protocolia_provider_lifecycle_causal_projection('PAY-CAND-RACE');
```

The result is derived from **one PostgreSQL MVCC statement snapshot**, never persisted as a mutable state and never interpreted as provider authorization or bank clearing. `causal_integrity` is one of `unobserved`, `gap`, `contradictory`, `coherent`. The latest phase is exposed only when the entire observed sequence starts at 1, has no gaps and passes the bounded transition policy. `last_coherent_phase` is NULL otherwise. **Even `coherent/reported_success` is not settled funds.**

Bounded synthetic transition policy: first observation must be `reported_pending`; pending may repeat or become success/failure; success may repeat or become reversal; failure and reversal are terminal (self-repeat only). This is a **diagnostic policy for synthetic reports**, not an authoritative gateway protocol. Missing sequence numbers take precedence over transition contradictions until the gap is filled. A later contradiction never rewrites or deletes the immutable journal.

## Reproducible tests

The existing [provider dual-target workflow](../../../.github/workflows/v12h-s2c1c0-provider-envelope.yml) runs:

```bash
node --test tests/vnext/provider-envelope-inbox.test.mjs
node scripts/vnext/probe-provider-inbox.mjs <generated-target-directory>
node scripts/vnext/probe-provider-http.mjs <generated-target-directory>
```

The PostgreSQL probe checks: an empty receipt; a gap (3), partial repair (3,1), full repair (3,1,2); a causally coherent success then reversal; rollback not changing projection; contradictory pending after reversal; existing failure→success contradiction; no changes to `payment.provider_settlement_state` or exact work-order balances. Existing 10-way replay/sequence conflict, HMAC and HTTP adversarial acceptance remain required.

**Evidence status:** PR CI and PostgreSQL results must be checked on the final commit before any merge; this file records the reproducible test design, not an unverified claim of success.

## Next work / explicit non-goals

This does **not** grant independent provider authority, perform settlement, alter a receipt, implement refunds or chargebacks, or enforce provider-specific bank causality. Future S2c gates require a real provider-specific authority model (credential provenance, provider-defined event ordering, independent reconciliation and revocation), financial reversal/refund treatment, tenancy/IAM, key lifecycle, recovery and independent business acceptance. No production deployment, live financial operation or stable financial tag.
