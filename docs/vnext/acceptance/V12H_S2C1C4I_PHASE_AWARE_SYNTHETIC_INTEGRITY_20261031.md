# S2c-1c4i — Phase-aware synthetic receipt integrity (no settlement authority)

**Scope:** generated Spring and NestJS PostgreSQL receipt integrity projection for the exact workshop ledger. This is a *read-only synthetic diagnostic*, not a bank-clearing integration. TL-14 #57 remains OPEN.

## Defect and invariant

Previously `protocolia_provider_receipt_integrity_projection(receipt_id)` returned `synthetic_only` for **every** causally coherent synthetic lifecycle, including `reported_pending`, `reported_failure` and `reported_reversal`. Consumers that only inspect `internal_integrity` could not distinguish a synthetic success from a synthetic failure/reversal. That was misleading even though `synthetic_only` never represented externally cleared funds.

The projection now preserves the legacy success classification and explicitly separates all four coherent phases:

| Last coherent phase | Internal integrity | Financial authority |
| --- | --- | --- |
| `reported_pending` | `synthetic_pending` | none |
| `reported_success` | `synthetic_only` (legacy success label) | none |
| `reported_failure` | `synthetic_failure` | none |
| `reported_reversal` | `synthetic_reversal` | none |

Existing `missing`, `unbound`, `claim_mismatch`, `not_posted`, `proof_changed`, `no_lifecycle`, `causal_gap`, `causal_contradictory` and `causal_unknown` classifications retain priority. The original `causal_integrity`, `last_coherent_phase` and `observation_count` columns and function signature remain unchanged.

**Important:** a coherent reported reversal is *not* a processed refund or a chargeback. A coherent reported success is *not* independent provider settlement. No receipt, charge, proof field, audit row or external account is modified.

## Independent acceptance

The existing provider workflow `.github/workflows/v12h-s2c1c0-provider-envelope.yml` runs against both generated Spring and NestJS targets, independently, on disposable PostgreSQL:

```bash
npm ci
node --test tests/vnext/provider-envelope-inbox.test.mjs
# In GitHub Actions, generate both targets and run:
node scripts/vnext/probe-provider-inbox.mjs <generated-app-path>
```

The real database probe checks: missing/unbound candidates, gap and out-of-order recovery, pending, success, failure, repeated terminal failure, success-to-reversal, contradiction after terminal state, rollback, internal reversal, proof tampering and unchanged exact balances. Expected marker: `PROTOCOLIA_S2C1C4I_PHASE_AWARE_SYNTHETIC_INTEGRITY_PASS` **per target**.

**Evidence status:** code and tests are proposed in this PR; verify actual workflow results and final head SHA before merging. A successful PostgreSQL test establishes only synthetic internal classification. No real provider identity/authority, cleared settlement, refund processing, chargeback handling, production IAM/tenant isolation, backup/restore or independent business acceptance is established.

No production deploy, live financial operations or stable financial release tags.
