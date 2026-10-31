# S2c-1b5 — committed correction lookup and lost-response recovery

Date: 2026-10-31 UTC. Functional SHA `1e778c671e4112a5108b00d0ccc33cc0e065c8a1`; base `f8ec1e301e88b018f0abb3f96cd13df9019423b8`. PR #72, issue #57 stays OPEN. Test data synthetic, disposable PostgreSQL and Chromium.

## Real GitHub Actions evidence

- [Generated itemized S2b/S2c financial acceptance #41182402041](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41182402041) — **SUCCESS in both NestJS and modular Spring**, from identical TypeSpec contract. Both job logs contain `PROTOCOLIA_S2C1B5_MOBILE_LOST_RESPONSE_PASS`, `PROTOCOLIA_S2C1B5_OUTCOME_PASS`, `PROTOCOLIA_S2C1B4_GLOBAL_KEY_PASS`, `PROTOCOLIA_S2C1B3_CAS_PASS`, `PROTOCOLIA_S2C1B1_ADJUST_ALL_PASS`. The S2b workflow compiles strict TypeSpec negatives and tampered OpenAPI checks, builds independently generated applications, runs generic real PostgreSQL conformance, and then runs actual HTTP/390×844 Chromium acceptance.
- [Historical exact receipt/reversal financial guard #41182402038](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41182402038) — **SUCCESS in both generated backends**, including PG-01 through PG-11 and the prior concurrency/reversal acceptance.
- [General quality #41182402069](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41182402069) and [push quality #41182397715](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41182397715) — **SUCCESS**.

## Executed recovery oracle

1. An authenticated manager creates an internal +0.20 correction. `GET /api/work-orders/OT-HTTP-ADJ/adjustments/AH-PLUS-01` returns exactly `{adjustmentId:"AH-PLUS-01",delta:"0.20",reason:"Corrección autorizada de ensayo",status:"committed"}`, with `Cache-Control: no-store`.
2. Unknown ID and same ID on a different order return HTTP 404; a read-only employee gets HTTP 403; invalid short ID gets 400. An existing row written by another actor cannot be claimed as this manager's outcome. GET leaves the journal and audit untouched.
3. Ten parallel same-ID corrections against ten distinct orders yield exactly one committed journal row. The lookup returns 200 only under the winning parent; the other nine parent lookups return 404.
4. Mobile Chromium performs a real authorized POST, waits for the upstream HTTP **201** after PostgreSQL COMMIT, and deliberately aborts delivery to the browser. The UI enters a blocked/uncertain state and explicitly offers **read-only outcome verification**. The browser GET returns 200, matches the original ID, exact delta and reason, displays committed status and leaves the journal row count unchanged. No second financial POST occurs.
5. Legacy 10-way receipt oversubscription, signed adjustment CAS/ABA, immutable charge lines and global correction ID uniqueness remain green. TypeSpec rejects invalid lookup privilege/verb/path. Adapter OpenAPI preflight rejects actor leaks, float money or ambiguous committed status.

## Security and product limits

The endpoint is read-only, authenticated, actor- and parent-scoped; a 404 is point-in-time **absence of a committed matching row**, not a promise that no concurrent transaction is pending. No auto-replay is allowed. The returned status is an **internal immutable correction journal commit**, not a bank/card settlement, legal invoice, fiscal credit note or provider refund. No production credentials, customer PII, payment provider, bank, deployment or stable financial tag were used. TL-14 remains OPEN for external settlement, refunds, production IAM/tenancy, tax/legal policy and recovery.
