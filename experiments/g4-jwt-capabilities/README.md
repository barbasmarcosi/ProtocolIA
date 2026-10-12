# G4 JWT trust boundary — isolated, tested profile

This is a **JWT resource-server prototype**, not a token issuer or an
internet-facing production authentication service. The verified output is
documented in [the G4 evidence](../../docs/G4_JWT_SCHEMATHESIS_EVIDENCE.md).

Input: Books v0.3 ProtocolIA contract -> G0 Basic OpenAPI and semantic
capability manifest -> **explicit, audited G4 Bearer JWT OpenAPI projection**
(with hashed provenance) -> OpenAPI Generator 7.26.0 (generated Java API/DTOs
only) + Java 21/Spring Boot 4.1.1 (user-owned JWT security/domain).

JWT policy: only configured **HTTPS JWKS** is trusted, **RS256** signatures,
issuer, audience, nbf/expiry verification; mapping of externally-issued
`books:read/write` OAuth scopes to internal `catalog.read/write` capability
authorities is code owned and enforced server-side. Token fields named
`capabilities` cannot mint privilege. Both HTTP filter and user-owned
domain delegate's `@PreAuthorize` require the correct operation capability.
A special opt-in to use **loopback HTTP JWKS** exists strictly for integration
tests, with per-run ephemeral RSA signing keys and no external IdP or secrets
in the repository. Existing Basic G1/React G3 demos are unaffected.

## Reproduction

```sh
docker build -f experiments/g4-jwt-capabilities/Dockerfile -t protocolia-g4 .
docker run --rm -p 10000:10000 -e PORT=10000 protocolia-g4
curl http://127.0.0.1:10000/health
```

Docker must complete all gates before producing its final image: semantic
manifest/policy drift guard, distinct Bearer projection+SHA provenance, Maven
real JWT HTTP+delegate tests, Schemathesis **GET-only** signed-JWT property
checks. The final image is deliberately **only a health/verification marker**,
not a running JWT application. No browser/production client should log in to
it. For actual deployment an independent real HTTPS OIDC IdP configuration,
key rotation, operations and security review are still necessary.
