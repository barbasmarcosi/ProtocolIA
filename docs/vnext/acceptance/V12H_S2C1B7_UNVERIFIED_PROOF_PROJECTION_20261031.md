# S2c-1b7 — exact unverified-provider-proof projection (frozen before CI)

Date: 2026-10-31. Base: `864a10e8ddd7d53d5e8c0d10b3d187bf4e3be4a2`. TL-14 / issue #57 remains OPEN.

## Risk and supported scope

An internal receipt may cover the entire order without any independent bank/card/provider settlement evidence. S2c-1b6 prevents clients from claiming external verification, but the order reconciliation did not expose the amount and number of posted receipts whose external proof is absent. The UI could display `covered` while omitting this material limitation.

## Generic TypeSpec / SQL semantics

An **optional** final `@reconcileExact(..., unverifiedProofField)` argument identifies a mandatory child field with `@fixedInitial("unverified")`. The compiler and independent SQL planner refuse a missing, nullable, client-writable, mutable or otherwise forged field. Existing contracts without this opt-in must retain their previous response shape and semantics.

For a valid opt-in, a single PostgreSQL MVCC snapshot adds two read-only JSON **strings**: `unverifiedPostedTotal` (exact decimal sum of **posted** child receipts with the fixed proof value) and `unverifiedPostingCount` (count of those receipts). Reversed receipts are excluded; the original `postedTotal`, `coverageState` and balance invariant remain unchanged. No binary floating-point math or provider-facing writes are permitted. The UI must display the amount, count and a visible non-settlement warning.

## Real acceptance required before merge

- Compile from the same canonical TypeSpec/IR into generated NestJS and modular Spring; fail closed for missing, non-fixed or wrong proof fields; retain old TypeSpec fixtures without the optional flag.
- Real isolated PostgreSQL/HTTP: 3 synthetic 1.00 receipts (cash, bank transfer, card) show `covered` **and** `unverifiedPostedTotal=3.00`, count 3. Reversal of one receipt gives `partial`, `2.00`, count 2; direct SQL corroborates exact amounts.
- Chromium at 390×844 displays the pending proof amount/count and explains that internal coverage does not certify external settlement. No new financial mutation, webhook or external service.
- Run all previous signed adjustments, CAS/ABA, global ID, lost-response recovery, immutable charges, 10-way oversubscription, legacy finance, and quality workflows on both generated adapters.
- Keep issue #57 open, do not deploy production, process real funds, publish a finance stable tag or claim external provider attestation.

## Explicit remaining gaps

No authenticated provider webhook, signature verification, trusted provider identities, replay window, PSP idempotency, bank reconciliation, actual refunds/chargebacks, tax/legal documents, production IAM, tenant isolation, or durable backup. This is a **truthful projection of unverified internal receipts**, not a verified settlement system.
