# v1.2e — charge-source bound opening amount: addendum to v1.2d

**Frozen before the negative tests; 2026-10-30.** This additive oracle does not rewrite v1.2d PG-01..PG-12.

**Contract semantics:** When `reconcileExact` explicitly names a nonnegative, non-null, immutable exact-decimal `chargeSource` on its parent entity, both generated runtimes must reject creation if the supplied `openingBalance` or `available` differs from the source monetary charge, **before** any insert. Only exact base-10 numeric equality is acceptable. After a successful check, persisted opening and available fields come from the source value, not client-supplied duplicates. All values must have the same declared scale; request bounds and wire encoding are retained.

**This is a strict source-bound validation, not yet a UX that omits redundant fields from CREATE input.** The generated form and HTTP request still require opening and available values, even though mismatches are refused. Existing financial debit semantics and reconciliation remain intact. No arbitrary expressions or JS Number calculation.

- CS-01: malicious initial `openingBalance="20.00"` and `available="20.00"` with `laborCharge="10.00"` must receive 400; no order persists.
- CS-02: malicious `openingBalance="10.00"` but `available="9.00"` must receive 400; no order persists.
- CS-03: correctly configured decimal `"10.00"` (same as `laborCharge`) persists exact values; source-bound reconciliation remains balanced.
- CS-04: repeated guarded receipts, overpay denial, 10-concurrent oversubscription and reversal continue to pass without any regression on both generated backends.
- CS-05: compile-time fail-closed: nonexistent charge field, nullable or wrong-type source, mismatched scale, or writable charge source cannot generate. The primitive is generic; no code must inspect literal `laborCharge`, `WorkOrder` or route names in templates.

**Not solved:** sum of labor + validated parts + tax for real orders, server-only balance input (currently duplicate fields still mandatory), safe change of charges after initial order creation, multi-currency, real banking/webhooks and production identity/backup. Issue #57 remains open until fuller finance acceptance. This work must never claim all of TL-14 complete.
