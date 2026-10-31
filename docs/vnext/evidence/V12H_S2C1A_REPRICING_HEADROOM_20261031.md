# S2c-1a exact read-only repricing preview — evidence

**Functional head SHA:** `9f352741c999f8ece3c07763c0c47eb7eb463e48`, 31 October 2026. This is a read-only limit forecast, **not approval or ability to change a charge**. Frozen acceptance at [S2c-1a](../acceptance/V12H_S2C1A_EXACT_REPRICING_PREVIEW_20261031.md).

## Independently verified CI

- [S2b+S2c-1a generated itemized workshop #41164104804](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41164104804): SUCCESS for both NestJS and modular Spring. The real isolated PostgreSQL/HTTP oracle verified:
  - initial `0.10 + 0.20 = 0.30` charge lines and `maxSafeDecrease=0.30`, `maxSafeIncrease=999999999999.69`;
  - zero-charge, a fully covered order (decrease=0), a partially covered order (decrease=current available), and an order at the 20-row bound (not eligible, zero bounds);
  - trusted source/journal consistency versus five privileged out-of-band drift types (not eligible, zero limits), restoration (eligible again), and existing 10 competing receipts/reversal;
  - generated React mobile 390×844 displays the correct values in the detail modal, reports zero JS page errors, provides **no mutation action** in the adjustment preview; both independently generated targets passed.
- [Prior scalar-ledger financial regression #41164104799](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41164104799): SUCCESS both NestJS and modular Spring, including preexisting payment guard scenarios and mobile forms.
- [General PR quality #41164104801](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41164104801): SUCCESS all five jobs (schema, artifact, runtime, both unit matrices). [Push quality #41164101451](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41164101451) also SUCCESS.

## Technical and product boundaries

The optional `@reconcileExact(..., adjustmentPreview=true)` is restricted to a matching immutable itemized exact source with a declared numeric max; TypeSpec and generator validations reject unsupported variants, missing ceilings, fake false opt-in, or nonnumeric injected max metadata. The one source-backed PostgreSQL NUMERIC snapshot returns `adjustmentPreviewEligible`, `maxSafeDecrease`, and `maxSafeIncrease`. Eligibility also requires room below 20 detailed rows, and source/journal drift zeros headroom and disables preview. All money is returned as exact JSON strings.

**WARNING:** These are arithmetic maxima under one read snapshot, not an authorization, offer, approval, or guarantee of future write success. There is no append-only adjustment, no compensating reversal/credit note, no taxes/discount calculation, no treatment of externally captured settlements, and no new POST/PATCH monetary endpoint. A future S2c-1b must enforce all security, audit, concurrency, idempotency, reason, signed amounts, customer authorization and receipt limits *inside the same write transaction*. Do not treat a read-only preview as proof of final business repricing policy.

Issue #57 remains OPEN. This milestone does not authorize a stable finance tag or production deploy.
