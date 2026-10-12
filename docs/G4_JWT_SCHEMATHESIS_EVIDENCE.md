# G4 — JWT capabilities + bounded Schemathesis pilot

**Gate status:** bounded G4 security pilot **VERIFIED** for the existing Books v0.3 API only; production OIDC / issuer provisioning and full contract/property-based write coverage remain **OPEN**.

**Last executable/tested source:** `22235015dcef0fce95c974a824f9cc6887a6d0dd`.  
**GitHub PR:** [#47](https://github.com/barbasmarcosi/ProtocolIA/pull/47).  
**Render Free validation service:** `srv-db6lq3s9v7es73815pd0`, build `dep-db6lvr5g1s2s739smidg`. Its public Docker image runs **only a marker HTTP server**, not the JWT protected Books app; full checks occur during build against loopback and newly created ephemeral keys.

## Actual composition and source-of-truth guarantees

- The **same version 0.3 ProtocolIA Books contract** produces the G0 nine-file resource and HTTP bundle. The original G0/G1 **Basic** OpenAPI projection remains untouched.
- `jwt_projection.py` validates the five operation IDs, paths, methods, capabilities, Basic requirements and public health before projecting a distinct truthful **Bearer JWT / RS256** OpenAPI 3.1 profile, with deterministic SHA-256 provenance (`openapi.g4-jwt.provenance.json`).
- Java 21, Spring Boot 4.1.1 and the real published `spring-boot-starter-security-oauth2-resource-server` starter. OpenAPI Generator 7.26.0 creates only generated controllers/API/DTOs and required `ApiUtil`; domain and security are user-owned.
- `JwtCapabilitySecurity`: `NimbusJwtDecoder` configured with a **trusted external JWKS** target and RS256, validates issuer, audience, expiry/nbf, explicitly disables HTTP Basic and form login, denies unknown routes. Normal JWKS configuration **must be HTTPS**. An opt-in test-only property permits `127.0.0.1` HTTP to exercise an ephemeral local JWKS without connecting a real IdP.
- Server-owned mapping converts **`books:read` → `catalog.read`** and **`books:write` → `catalog.write`** only after JWT signature/claims verification. Untrusted JWT `capabilities` claims cannot assign permissions. OAuth scopes and ProtocolIA capabilities are separate namespaces.
- `BooksDelegate` uses explicit method-level `@PreAuthorize` for all read/write methods in addition to HTTP method-path matching. `verify_capabilities.py` rejects drift across all five declared operations, the hand-reviewed Spring filter chain and delegate annotations.
- No private signing key, hardcoded real password, token-issuing endpoint, production OIDC configuration or public JWT API is deployed.

## Tests and observed evidence

**Java/JWT integration:** Maven `clean verify` **BUILD SUCCESS**, **7/7 HTTP/method-security JUnit** tests, zero failures/errors/skips, at exact code SHA above. Tests run the Spring MVC app on a random loopback port with a **real ephemeral RSA keypair and JWKS HTTP server**. They exercise signed positive JWTs, no token, invalid Basic scheme, wrong issuer, wrong audience, expired token, future `nbf`, wrong RSA signing key, unsupported scopes and injected capability claims. Verified HTTP 200/201/400/401/403/404/409, parameter validation, and explicit reader-versus-writer permissions. Two additional tests invoke the proxied service directly with restricted Spring Security contexts, proving `@PreAuthorize` remains effective even when not relying on the HTTP filter.

**Property-based contract testing:** `schemathesis==4.30.1` with `PyJWT[crypto]==2.10.1` executed against the **real local JWT resource-server**, fed the distinct Bearer OpenAPI. The bounded `GET`-only run includes three operations, positive/negative generation, `status_code_conformance` and `not_a_server_error`; Schemathesis reported **3 operations passed, 2,263 generated cases passed** at the exact tested source SHA `22235015dcef0fce95c974a824f9cc6887a6d0dd`. This is a fresh, standalone run after the new direct-method security tests; **3/3 GET operations passed and 2,263 generated checks passed**. This does **not** count as contract/property verification of POST/PATCH or database effects.

**First failures retained:**
1. Invalid `DelegatingOAuth2TokenValidator` import (`jwt` rather than `oauth2.core`) initially prevented compilation; fixed.
2. First CLI Schemathesis run timed out because JVM server stdout was a never-drained pipe under negative inputs. Redirected Java logs to file, enforced a bounded execution time and sanitized timeout reports so ephemeral JWT contents do not leak.
3. The initial G4 generated API still described Basic even though runtime used Bearer. Dedicated, deterministic G4 JWT projection with explicit provenance corrected the spec/runtime mismatch without mutating G0/G1 contracts.

## Security posture and rollout decision

**Keep the working Basic demo profile for G1–G3 unchanged.** Keep the JWT G4 implementation an **isolated verified candidate**, *not* an automatically enabled public production service. The published Render image exposes only `GET /health` with `jwt_api_publicly_enabled=false`; it is a build marker, not a JWT storefront.

Remaining hard blockers: integration with a real, managed OIDC issuer and live HTTPS JWKS rotation, trusted audience/issuer configuration and operational secret handling, refresh/session lifecycle, capability policy over multi-resource domains, fuller negative/positive schema/error-body coverage, mutating Schemathesis on isolated database-backed fixtures, and G5 durable persistence. P4 remains frozen; no paid AI APIs or GitHub Actions minutes used.

**Next:** G5 reproducible full-stack regeneration/contract evolution and durable DB tests, or first expand the narrow G4 pilot with controlled external-IdP integration before production rollout. No claim of security audit or productivity/time saving.
