# S2c-1c0 — provider-neutral cryptographic envelope preflight

Frozen: 2026-10-31. Base: `8b74ff822cf3e94c0ab6fb076aa4e7ba4e0114b6`. Issue #57 / TL-14 remains **OPEN**.

## Threat and boundary

The generated workshop application now truthfully labels all internally posted receipts as **externally unverified**. A later integration must not trust a webhook simply because it arrives at an HTTP endpoint, supplies an event ID or declares `settled`. This submilestone implements a **reusable dormant verifier** in both generated NestJS and modular Spring artifacts, not a webhook endpoint or settlement mutation.

## Versioned signature contract

A provider-specific adapter will eventually supply **the original HTTP request bytes** and server-configured key material to the verifier. Canonical HMAC-SHA256 message bytes are:

```text
protocolia-provider-proof-v1\n
<keyId>\n
<unixTimestampSeconds>\n
<eventId>\n
<raw HTTP body bytes>
```

The text above denotes literal LF separators (no blank lines), followed by the unmodified body bytes. The transmitted signature is `v1=` plus 64 **lowercase** hexadecimal characters. Key ID is 1–32 ASCII alphanumeric/underscore/hyphen characters; event ID is 8–128 of the same alphabet. Timestamp is exactly 10 canonical positive Unix-second digits. Accept at most 300 seconds of absolute clock difference; reject milliseconds, duplicate/ambiguous headers at the eventual HTTP adapter, empty body, bodies above 65536 bytes, missing key, key not exactly 32 bytes, and keyring size outside 1–3. A trusted server-side key ID selects the key; do not try all retired keys. Never sign parsed or reserialized JSON.

On success return only `keyId`, `eventId` and `payloadSha256`. No `settled` flag, credit, refund, audit or payment mutation may be inferred. No provider secret is exposed in generated UI or HTTP responses.

## Required verification

- Frozen test vector: key = 32 bytes `0x11`; keyId `sandbox_1`; timestamp `1793440000`; eventId `evt_12345678`; body `{"provider":"sandbox","amount":"1.00","event":"settled"}`; expected signature `v1=12eb6b3aca418544295012e183c6401db154e9c536b85470a2c37145927eabdb`, payload SHA-256 `20ece580daf2c31f7706a02043618938a28ea1fdf4041fabab1fc2f9558259eb`.
- Independent Node 24 and Java 21 tests must accept the same vector, reject modified body, signature, timestamp, event ID, key ID, weak keys, malformed headers, stale/future delivery and oversized body. Test exact ±300-second boundaries.
- The same unmodified TypeSpec/IR must generate and compile NestJS and Spring apps with the dormant verifier present. Existing real PostgreSQL/HTTP conformance and S2b/S2c financial regressions must remain green.

## Explicitly NOT implemented or proven

A valid signature is **not** replay protection: repeated delivery authenticates twice. The next milestone requires a PostgreSQL **atomic unique event inbox** keyed by provider identity and event ID, with payload-digest collision checks, bounded retention, a verified provider-specific payload schema, HTTP raw-byte capture before JSON parsing, request header cardinality checks, secret rotation/revocation policy, and safe conflict semantics. Do not mark an internal receipt bank-settled, write refunds, or accept provider financial callbacks until those independent controls are implemented and proven against both generated adapters with real HTTP/PostgreSQL.

No production credentials, provider requests, financial settlement, real refunds, deployment or stable finance tag are authorized by this preflight.
