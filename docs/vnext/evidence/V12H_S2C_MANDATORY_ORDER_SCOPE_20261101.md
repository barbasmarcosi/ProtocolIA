# S2c: mandatory order scope for offline comparisons (2026-11-01)

## Risk and functional change

Previously the unsigned offline CLI accepted a receipt export containing several orders without `--expected-order`. A fully matched cross-order set could return exit 0 and `amounts_agree_unverified`, creating a misleading scoped comparison. Signed invocations already required an expected order.

All invocations now require an operator-selected `--expected-order <orderId>`. The CLI validates that the internal export is **nonempty** and that **every** internal receipt has exactly that order ID before loading external data or writing replay state. Missing, malformed, empty, wrong-order and mixed-order exports exit **1** with **no JSON report**. The CLI's exact-decimal comparison, optional detached Ed25519 verification, and local replay controls remain unchanged.

## Breaking migration

Pass the expected order on **every** CLI invocation, including unsigned comparisons:

```sh
node scripts/vnext/reconcile-provider-statement.mjs \
  --internal receipts.json --expected-order OT-1 \
  --links reviewed-links.json --external provider-events.json \
  --currency ARS --scale 2
```

This flag is an explicit **operator scope assertion**, not authentication, authorization, a database row-level security policy, a trusted provider identity, or bank settlement proof. The exported receipt set must be obtained using a separately authorized order-scoped query. External event and link mismatches are still reported as exceptions; a clean comparison remains **non-authoritative**.

## Regression and verification

`node --test tests/vnext/provider-statement-cli.test.mjs` exercises normal comparison, returns, malformed inputs, wrong and mixed order, empty export, and the new missing-order refusal. The S2c CI runs the full provider-statement suite on Node 22 and 24. Cross-target NestJS/Spring workflows must remain green before merge.

No real payment, refund, settlement, production deployment, or stable financial release is authorized. Issue #57 stays open.
