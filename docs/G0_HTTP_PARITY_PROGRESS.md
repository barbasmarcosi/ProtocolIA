# G0 progress — truthful Java demo HTTP profile

**Status: IMPLEMENTED IN BRANCH; REAL BUILD / HTTP VERIFICATION PENDING.**  
**Date:** 2026-10-12. **Gate:** G0, partial implementation only.  
**Sources:** [full-stack implementation gates](FULLSTACK_IMPLEMENTATION_PLAN.md), [ADR-003](ADR-003-FULLSTACK-COMPOSITION.md).

## What this change implements

- New provider-free command:
  `PYTHONPATH=src python -m protocolia compile-http examples/stock-change/protocolia/contract.json --profile java-spring-basic-demo --domain-errors examples/stock-change/protocolia/http-errors.json --out /tmp/catalog-http`.
- An explicit bounded **Java demo target projection** that validates the Java generator's supported model profile; preserves canonical v0.2 IR/JSON Schema and historical default OpenAPI output byte-for-byte. It emits a distinct ownership manifest to prevent accidental mixed regeneration.
- Declares HTTP **Basic**, not fictional Bearer, for the real demo target; POST **201**, GET/PATCH **200**; generated-adapter possible 400, 401, 403, 501 responses as appropriate; explicit implementer-declared 404/409 for the actual stock-change scenario. It does **not** claim an unobserved error-body schema.
- Includes a strict domain-status sidecar for the sample. No domain 404/409 inferred merely because an operation is GET/PATCH/POST.
- The stock-change sample now outputs its target-specific OpenAPI next to (not replacing) the generated Spring project. Docker build runs new Python projection/CLI tests and pre-existing real Java HTTP tests.

## Test scope, pending and limits

- Python tests: target-specific path/operationId/security/status/effects, deterministic output, safe ownership, unchanged generic compiler, unsupported Java model rejection, invalid domain status rejection and real CLI.
- Independent Maven integration tests in the existing sample cover actual create 201, GET/PATCH 200, 400, 401, 403, 404, 409, 501 startup behavior where appropriate, and atomic concurrent stock adjustment.
- **Explicitly not completed by this PR:** new typed Resource/View/Capability/Effect IR, pagination/query parameters, ui/capability/generation manifest projections, external Spectral/oasdiff tooling, complete error serialization/headers parity, OpenAPI Generator 7.26.0 replacement, Orval/Kubb client, JWT/OIDC and RJSF. Those remain gates.
- Historical default OpenAPI v0.2 intentionally still advertises Bearer/200; consumers must opt into the target projection and must not mistake the default for this Java target. A later versioned compiler evolution will make target-scoped output the standard supported path.
- Do not claim a production API identity provider: Basic is a local demonstration profile.

## Upstream references

- [OpenAPI 3.1 HTTP security schemes](https://spec.openapis.org/oas/v3.1.0.html)
- [Spring Security HTTP Basic](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/basic.html)

Update this document with exact pass/fail build evidence and SHA after independent execution.
