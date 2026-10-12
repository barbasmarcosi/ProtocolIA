# G4: JWT bearer-only resource server and trusted capability mapping

**Initial isolated security experiment; verification pending real Maven/HTTP
tests.** This is NOT a production-enabled OAuth/OIDC deployment.

Source is the exact Books v0.3 contract and target-specific OpenAPI consumed
by G1/G2/G3; the existing Basic-auth G1 sample remains unmodified.
OpenAPI Generator 7.26.0 generates DTOs and Spring MVC ports, while handwritten
G4 Security configuration owns JWT validation and all operation/capability
permissions. Java 21, Spring Boot 4.1.1 and Spring Security are the candidate
runtime. No token-issuing endpoint or bundled secret/private key is deployed.

Trusted configuration requires an HTTPS issuer, HTTPS JWKS endpoint, expected
audience, and **distinct OAuth read/write scopes**. A server-reviewed scope
mapping produces ProtocolIA `catalog.read` and `catalog.write` authorities;
untrusted token `capabilities`/roles claims never grant privileges. A
test-only dynamic property allows **127.0.0.1 ephemeral HTTP JWKS** for tests;
production configuration fails closed otherwise.

All Books methods in the user-owned G4 delegate have `@PreAuthorize` in
addition to the HTTP access policy. A build-time manifest guard rejects
unreviewed method/path/capability drift and omitted server/handler checks.
Tests will use freshly generated RSA private keys (in-memory only), a
locally served JWKS and actual signed Bearer tokens to verify audience,
issuer, expiry, not-before, signature, read/write role matrix, 400/401/403/
404/409 and strict Basic/unknown-method denial.

The final Render image exposes a **health marker only**, not a public JWT
bookstore, until an independently controlled real IdP and production safety
review exist. Schemathesis with bounded traffic is a separate upcoming
sub-gate within G4.
