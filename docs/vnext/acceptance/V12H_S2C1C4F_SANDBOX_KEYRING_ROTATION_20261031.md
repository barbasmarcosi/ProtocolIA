# S2c-1c4f — bounded sandbox provider keyring and safe rotation

Base main: `da9809553e7b9a44785c2c5f7564313fe5e4cc16`. TL-14 / #57 remains OPEN.

## Functional security boundary

Both independently generated NestJS and Spring sandbox HTTP receivers now accept
either the legacy `PROTOCOLIA_PROVIDER_SANDBOX_KEY_HEX` (one `sandbox_1` key)
or the new `PROTOCOLIA_PROVIDER_SANDBOX_KEYS` list of
`id=64_lowercase_hex` pairs separated by commas, with **1–3 distinct key IDs
and key materials**. Simultaneously configuring both variables, empty or
malformed entries, duplicate IDs, reused key material and oversized keyrings
fail closed (503). Unknown or removed IDs fail authentication (401); there
is no fallback to another key.

The server selects the trusted key by signed key ID. It still authenticates
route-specific raw bytes, never client-declared provider identity. A removed
key ID is revoked for new requests, while historical inbox records persist.
Overlapping keys permit rotation without double-processing: the same event
ID signed under a second key is an immutable duplicate, not a second receipt
or lifecycle event.

The default sandbox is disabled, requires demo auth mode, and never grants
bank settlement authority or permits real financial operations.

## Reproducible acceptance

Run `node --experimental-strip-types --test tests/vnext/provider-webhook-envelope.test.mjs`
and compile/run `tests/vnext/ProviderWebhookVerifierTest.java` alongside the Java
verifier. Run `.github/workflows/v12h-s2c1c0-provider-envelope.yml` on the PR.
That workflow independently generates both targets and runs disposable
PostgreSQL/HTTP probes: active-key overlap, cross-key duplicate, unknown key
rejection, receipt and lifecycle replay, concurrency, rollback and financial
invariants. Do not declare green until the actual CI jobs are checked.

## Remaining

Actual provider identity/authority and protocol, independently verified
settlement, refunds and chargebacks, production IAM and backup/restore, and
independent business acceptance. Keep issue #57 OPEN. No production deploy,
stable financial tag or real financial operation.
