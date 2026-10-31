# v1.2g — Generic bounded multi-charge initial ledger

Frozen acceptance (2026-10-30 local), before the first functional change. **Independent additive successor** to Draft PR #58. Neither PR #55, #56, #58 nor main will be merged or changed.

## Source declaration

Retain `@reconcileExact` and its stable parameters. Its optional `chargeSource` argument may now be either a **single named exact-decimal field** (legacy v1.2e/f behavior) or a **comma-separated list of 2–4 distinct fields** (new bounded exact sum); use `@reconcileExact(..., "laborCharge,partsCharge", true)`. Treat the CSV as a declaration of field names, **never** code or SQL and never dynamic expressions. Canonical IR stores a validated `chargeSources` vector for a multi-source rule, and retains `chargeSource` for the old single-source rule. Both adapters use one shared normalized source vector in the validated plan.

All source fields must be immutable through the declared API, required, non-null, nonnegative exact decimal strings; all source scales must match `openingBalance`/`available`. Reject duplicates, empty fields, unknown/wrong-type/nullable/negative-allowing sources, unsupported count, scale mismatch, patch/delete/reassignment bypasses and a malicious CREATE DTO with either server-derived balance. The max precision is bounded by the balance field; the sum **might overflow** even when each individual source is valid, so enforce the aggregate bound at runtime.

## Frozen executable oracle

- MS-01: labor 10.00 + parts 5.00 → opening=available=15.00 on read and reconciliation; CREATE DTO and mobile UI never expose opening/available; actual POST has both charges only.
- MS-02: decimal binary-float trap 0.10 + 0.20 must persist exactly 0.30, never 0.30000000000000004. Source formatting may be canonicalized; numeric equality must use decimal minor units.
- MS-03: bounded max: `999999999999.99 + 0.01` is 400 with **zero inserted order**, not PostgreSQL 500 or silently rounded, in both engines. Exact boundary `999999999999.98 + 0.01` succeeds with the expected amount.
- MS-04: negative `partsCharge="-0.01"`, non-decimal JSON number, missing part or null part are HTTP 400 and no inserted row.
- MS-05: spoofed client opening/available fields (including equal values) are 400 with zero inserted order; no bypass via alternative mutation or deletion.
- MS-06: preserve 11 prior financial tests incl. 10 simultaneous payment debits for 3.00 and single reversal; immutable charged order and payment journal.
- MS-07: five older compile-invalid cases and additional negative **duplicate source**, **unknown source**, **wrong scale**, **too many sources**, **nullable source**, **negative-allowing source** must all be compiler errors, not runtime 500 or successful generation.
- MS-08: independent real Spring and Nest PostgreSQL HTTP conformance, identical canonical IR SHA and 390×844 Chromium mobile generated form with both charges and **without balances**, zero browser JS errors. No per-entity generated business code.
- MS-09: single-source legacy TypeSpec contracts remain accepted, no previously verified bounded payment behavior weakened.

## Excluded intentionally

This only adds declared **scalar, immutable, nonnegative invoice-like charges**. It does **not** generate variable-length parts line items, tax rules, discounts, refunds, repricing after payments, legally compliant invoices, externally authorized payments, production IAM or multi-tenant financial segregation. Issue #57 remains open. The source document and observed CI hashes are separate from this pre-implementation rubric.