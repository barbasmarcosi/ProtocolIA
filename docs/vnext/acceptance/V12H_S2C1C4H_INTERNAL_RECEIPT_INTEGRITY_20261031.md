# S2c-1c4h — Internal receipt integrity projection (synthetic only)

**Scope:** independent generated NestJS/Spring PostgreSQL schema; no live provider, banking, refunds or settlement authority. TL-14 #57 remains open.

## Threat addressed

The previous causal projection could truthfully return `coherent/reported_success` for an immutable synthetic event stream **even after the associated internal receipt had been reversed or its amount/proof altered**. Reading that phase alone risks implying financial settlement. This milestone adds a second, single-statement PostgreSQL `STABLE` projection that refuses to treat the synthetic report as authoritative.

`protocolia_provider_receipt_integrity_projection(receipt_id)` returns four columns: `internal_integrity`, `causal_integrity`, `last_coherent_phase`, and `observation_count`. It joins the current internal receipt, immutable receipt candidate, and existing causal stream under one PostgreSQL MVCC snapshot. The status is fail-closed:

- `missing`, `unbound`, `claim_mismatch`, `not_posted`, `proof_changed`
- `no_lifecycle`, `causal_gap`, `causal_contradictory`, `causal_unknown`
- `synthetic_only`: a consistent **internal** binding and coherent **synthetic** report; **never external clearance**.

It does not write to receipts, audit, balances, candidate claims or provider observations. It adds no public HTTP endpoint, payment action or real provider credential. It preserves the existing causal projection signature.

## Reproduce

From a clean checkout of the PR, run `npm ci` and `node --test tests/vnext/provider-envelope-inbox.test.mjs`. The CI workflow `.github/workflows/v12h-s2c1c0-provider-envelope.yml` independently generates both NestJS and Spring from `examples/vnext/workshop-itemized-guard`, starts disposable PostgreSQL and runs `node scripts/vnext/probe-provider-inbox.mjs <generated-app-path>` plus signed HTTP probes.

The PostgreSQL probe asserts missing and unbound receipts; a gap at sequence 3; recovery after 1 and 2; coherent-but-synthetic success; contradictory terminal transition; rollback; no-lifecycle candidate; reversal overriding the previously coherent report; and database-level amount/proof tampering either rejected or detected, with rollback. It checks that `provider_settlement_state` stays `unverified` and internal monetary values remain unchanged.

**Acceptance:** verify the final PR-head CI results independently; this document alone does not assert passing tests. Do not merge until all relevant workflows pass. No external provider authority, independently verified settlement, refund, chargeback, production IAM, backup or business acceptance is established.
