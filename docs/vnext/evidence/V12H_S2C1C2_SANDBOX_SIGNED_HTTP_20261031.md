# S2c-1c2 — signed synthetic HTTP provider ingress (not settlement)

Date: 2026-10-31. Base `main` `355f85ee06ea5bf843be09b2e40542a2766960b2`. Issue #57 remains OPEN.

## Invariant and scope

Both independently generated adapters accept a POST to
`/api/_protocolia/provider/sandbox/inbox` **only** when the canonical contract
contains the source-bound provider proof inbox, `PROTOCOLIA_PROVIDER_SANDBOX_ENABLED=true`,
`PROTOCOLIA_AUTH_MODE=demo`, and a trusted 32-byte lowercase hex
`PROTOCOLIA_PROVIDER_SANDBOX_KEY_HEX`. This is a synthetic, test-only
transport; production provider authority is NOT supported.

- Header set (each exactly once): `X-ProtocolIA-Key-Id` (currently
  `sandbox_1`), `X-ProtocolIA-Timestamp`, `X-ProtocolIA-Event-Id`,
  `X-ProtocolIA-Signature`.
- `Content-Type: application/json` and 1..65536 original bytes, never
  reconstructed from parsed JSON. HMAC-SHA256 covers the canonical domain,
  key ID, Unix seconds, event ID and raw bytes. Five-minute signed window.
- The provider identity is server-pinned `sandbox_provider`, not a field
  accepted from a caller. The database uniqueness key is
  `(provider_id,event_id)`, independent of signing key.
- The existing atomic PostgreSQL function returns `stored`, `duplicate`
  or `conflict`, exposed as HTTP 202, 200 or 409. Malformed request 400,
  invalid signature 401, disabled endpoint 404, transient serialization
  503. Response is `Cache-Control: no-store`.
- No callback may update `payment`, work-order balance, refund, settlement,
  audit of payment, or external provider status. A stored digest is NOT
  evidence that money was cleared.

## CI acceptance

Workflow `.github/workflows/v12h-s2c1c0-provider-envelope.yml` runs a
matrix of NestJS and modular Spring from identical TypeSpec, cross-language
HMAC vectors, generic PostgreSQL/HTTP conformance, 10-way SQL inbox replay,
and `scripts/vnext/probe-provider-http.mjs` against disposable Compose apps.

The HTTP oracle requires exactly one 202 and nine 200 on ten concurrent
identical signed events, 409 for a different authenticated payload with the
same event ID, 401 for tampering and expired signatures, 400 for missing
headers, successful HMAC without browser credentials, and zero payment rows.

**Evidence status:** pending full green CI on the PR head; do not merge until
both matrix jobs and all other relevant regressions succeed. The test oracle
is project-authored and does not prove real bank/provider integration.

## Explicit exclusions

No production webhook configuration, provider discovery, actual payout
confirmation, legal refund/chargeback, provider signature specifications,
tenant-scoped authority, secret rotation policy, reconciliation with bank
records, financial certification, or real financial operations. All tests
use random local secrets and synthetic events.
