# S2c — independent discrepancy completeness (bounded, read-only)

## Defect and contract

The offline comparison previously chose **one primary classification** per receipt.
When a reported capture was wrong *and* the same provider transaction was
over-refunded, only the first branch's exception survived. A reversed internal
receipt could similarly mask a return-kind mismatch. Operators could
underestimate the number and nature of financial exceptions.

The primary `rows[].classification` is preserved for compatibility. The
`exceptions[]` collection and `counts.exceptions` now represent **all
independent observed conditions**, not just the highest-priority one:

- Nonzero capture differs from internal receipt amount.
- Provider-reported refund plus chargeback exceeds captured amount, even with
  zero captures or when the provider transaction is unmatched.
- An externally captured receipt is internally reversed.
- When a separate internal return journal was supplied, provider-reported
  refund and chargeback amounts disagree with it **by kind**.
- A reversed internal receipt has a separately recorded local return, which
  needs human double-credit review even if there is no provider crosswalk.
- Previously enforced impossible local over-returns, missing links, duplicate
  IDs, unknown sources and malformed exact decimals remain fail-closed.

The additional conditions are not duplicate instances of the primary code for
the same receipt. They are deterministic, sorted and read-only. A missing
optional internal return journal is **not** silently treated as verified
coverage. `amounts_agree_unverified` and `returns_agree_unverified` are
unchanged; neither is evidence of bank-cleared settlement.

## Reproducible acceptance

```sh
node --test tests/vnext/provider-statement-reconciliation.test.mjs \
  tests/vnext/provider-statement-multi-anomaly.test.mjs \
  tests/vnext/provider-statement-cli.test.mjs
```

The dedicated Node 22/24 CI and the two independently generated
NestJS/Spring provider-preflight CI must pass before integration. The latter
also exercises disposable PostgreSQL, signed **sandbox** HTTP ingress and
rollback/replay tests; it is not a real payment-provider certification.

**Out of scope:** authenticated independent bank statements, persistent
financial reconciliation, tenant IAM/RLS, actual refunds/chargebacks,
production recovery and business acceptance. Keep TL-14 #57 open.
