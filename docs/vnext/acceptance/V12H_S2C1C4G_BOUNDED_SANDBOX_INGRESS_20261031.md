# S2c-1c4g — bounded sandbox webhook ingress (security hardening)

Base `main`: `fbf6be1f3a751396e7d8e0f386f82b97fbdcfecf`.
TL-14 / #57 stays OPEN. This is synthetic ingress only, not a provider
settlement protocol or an authority to move money.

## Security failure and correction

Previously the generated Spring controller accepted `@RequestBody byte[]`,
which asks Spring MVC to materialize the entire untrusted HTTP request
**before** the controller's 65,536-byte check. An attacker could submit
oversized or chunked requests that consumed application memory without
ever authenticating a signature. Nest's JSON parser has its own bounded
body-parser limit, and its sandbox controller also checks 65,536 bytes.

The Spring controller now reads at most **65,537 bytes** directly from the
servlet request stream. It rejects declared Content-Length above 65,536
before reading and rejects chunked/unknown-length streams as soon as
the extra byte is observed. The 65,536-byte boundary remains accepted.
All signature verification and PostgreSQL work occur after this bound.
No generated business contract or financial SQL semantics changed.

The Spring sandbox also requires an **explicit**
`PROTOCOLIA_AUTH_MODE=demo` value rather than silently treating a missing
variable as demo at this ingress boundary. This matches Nest's explicit
runtime check. The generated Docker Compose examples already set demo
mode explicitly; sandbox remains opt-in and never available as settlement.

## Reproducible checks

The existing provider workflow
`.github/workflows/v12h-s2c1c0-provider-envelope.yml`
generates NestJS and Spring independently from the unchanged workshop
TypeSpec, then runs `scripts/vnext/probe-provider-http.mjs` against
isolated real PostgreSQL and HTTP. The new probe exercises:

- Exactly 65,536 valid signed JSON bytes: HTTP 202 and one inbox record.
- 65,537 signed JSON bytes with Content-Length: HTTP 400/413, no record.
- 65,537 signed JSON bytes as a chunked stream: HTTP 400/413, no record.
- No new receipt binding or lifecycle observation, and provider settlement
  remains `unverified`.

Run Node syntax checking with
`node --check scripts/vnext/probe-provider-http.mjs`.
Confirm the actual provider workflow, quality and financial CI jobs
before merge. Do not infer passing CI from this plan.

## Explicit exclusions

No external provider authority, independently verified bank settlement,
refund or chargeback accounting, production IAM/tenant isolation, backups,
or independent business acceptance. No production deployment, real
financial operation or stable financial tag.
