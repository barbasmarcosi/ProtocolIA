# v1.2h-S2b-1 — immutable itemized exact charge-source integration

**Evidence recorded 2026-10-30 (Argentina local), on tested functional head `a9bd622c69363348dfa2a13d351af9ccc0b932ac`.** This is an independent bounded nonproduction contract demonstration, not a certification of the full TL-14 financial lifecycle. Source: [PR #64](https://github.com/barbasmarcosi/ProtocolIA/pull/64).

## Verified completed real CI

- [S2b exact itemization #41162413263](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41162413263): **SUCCESS for independently generated NestJS and modular Spring**. Each job compiled the new TypeSpec contract with negative fixtures, generated the real app, ran generic HTTP conformance against isolated actual PostgreSQL, then executed the synthetic workshop itemization oracle and 390×844 Chromium.
- [Legacy exact finance #41162413300](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41162413300): **SUCCESS for NestJS and Spring**. Preserved previous exact multi-charge, ledger drift/reversal, authorized/unauthorized, concurrency and mobile-browser acceptance for the unchanged legacy workshop fixture.
- [PR general quality #41162413319](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41162413319): **SUCCESS five jobs** (both Python unit variants, schema/runtime, contract/schema and artifact checks). [Push quality #41162412709](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41162412709) also SUCCESS.

## Supported observations (S2b independent oracle)

- **S2B-01:** one parent and its 1–20 typed `ChargeLine` children are committed atomically. Two independently validated exact charge strings `0.10` + `0.20` yielded `0.30` in the server-derived `chargeTotal`, `openingBalance`, `available`, and committed child rows; reconciliation returned `unpaid`.
- **S2B-02:** client attempts to supply `chargeTotal` or `openingBalance` rejected HTTP 400 without parent creation; the generated UI omits all three server-owned amount inputs.
- **S2B-03:** empty or 21-row requests, negative or non-string amounts, nulls, unexpected fields, forged FK and overflow are rejected without a created parent; duplicate child identity caused HTTP 409 and full parent rollback; 20 exact 0.01 rows were accepted.
- **S2B-04:** independent POST to financial child resource rejected HTTP 409 (unauthorized reader refused); no unintended child persisted, original exact total unchanged.
- **S2B-05:** under 10 concurrent posted receipts of 1.00 against one 3.00 order, exactly three returned 201 and seven returned 409, with full internal coverage. Once-only reversal moved coverage to `partial`; repeating reversal gave 409.
- **S2B-06:** original exact server-derived `chargeTotal` is captured in the durable order audit; an explicit one-row zero-charge order yielded `coverageState=no_charge`. Generated 390×844 Chromium could add charge rows before creation without exposing balances, while reporting zero page JavaScript errors.

## Implementation boundaries and security

The new financial mode is explicit `@createDetails(childEntity,parentField,rowsField,chargeAmountField,chargeTotalField)`, restricted by the TypeSpec compiler and both adapters to nonnegative bounded exact child money and a sole immutable reconciled source field. It reuses the existing bounded atomic detail workflow, validated exact decimal construction and transaction rollback. Generic nonfinancial header/details remain supported, and the previously integrated financial contract is regression-tested independently.

**Not supported or not proven:** production IAM/tenant isolation or external backups, real card/bank settlement, provider idempotency, refunds, legal invoicing, tax/discount calculations, variable parts/inventory pricing, business-approved repricing, or external customer acceptance. `covered` means internally posted coverage only. This run does **not** independently prove detection of a privileged out-of-band change to a charge row after creation; future hardening must address trusted data repair and source consistency. Because the current TypeSpec child CREATE declaration is needed by existing `@createDetails` generation but direct child POST always returns 409, the public declaration and runtime behavior should be aligned in a future semantic revision instead of presenting this as a complete public API.

Issue [#57 TL-14](https://github.com/barbasmarcosi/ProtocolIA/issues/57) stays **OPEN**. No tag, external financial integration, or production deployment is authorized by this milestone.
