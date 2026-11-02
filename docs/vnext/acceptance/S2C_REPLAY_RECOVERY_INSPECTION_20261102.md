# S2c: read-only local replay recovery inspection (2026-11-02)

## Threat and bounded change

The optional signed-provider event replay guard deliberately leaves a provider-scoped lock after an interrupted claim. Removing it without inspecting potentially partial markers could admit a second financial statement with duplicate event IDs. Operators previously had no generated, fail-closed inspection interface.

Run on the **same Linux host**, using the same private directory as the existing optional `--local-event-replay-dir`:

```bash
node scripts/vnext/inspect-provider-event-replay.mjs --local-event-replay-dir /path/to/private-replay-state
```

Exit code **0**: no provider lock observed, but **not** proof of completeness. Exit **2**: one or more durable locks; stop and perform manual incident review. Exit **1**: malformed or unsafe directory/record; stop. The JSON report counts event markers and provider locks without exposing financial amounts. The inspector **never removes** a lock or marker, never claims an event, and never invokes a bank/provider.

## Guardrails

- Verifies private owner-only directory identity, opened descriptor and Linux `/proc/self/fd` anchor. Rejects symlinked directories, entries and observable path substitutions.
- Reads at most 20,000 entries, 1 KiB per entry; accepts only canonical generated event markers and provider locks, validates exact field sets, hash-shaped IDs, name-to-record correspondence and private file permissions.
- Fails closed on malformed, duplicate-key, oversized, unexpected, symlinked or world-readable records.
- Node 22/24 CI runs the real event-claim implementation, validates immutable read-only inspection, crash lock exit 2, blocked subsequent claims, invalid-state exit 1 and path/permission negatives.

## What it does not prove

These files are not a tamper-evident database: a privileged operator can delete or rewrite them. A clean scan cannot establish event completeness, distributed uniqueness, actual provider identity, settlement, refund clearing or a safe automated lock release. Manual recovery must correlate signed source bundles, immutable external evidence and original event IDs before any deliberate remediation. **No automatic recovery command is provided.**

The generated Spring/Nest financial ledger and PostgreSQL transaction paths are unchanged. TL-14 (#57) remains open for independently trusted provider onboarding, durable multitenant audit, distributed replay, real refund/chargeback settlement, production IAM/backups and independent business acceptance. No production deployment, financial tag or real-money operation.
