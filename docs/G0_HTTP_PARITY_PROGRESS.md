# G0 progress — truthful Java demo HTTP profile

**Status: G0 PARTIALLY VERIFIED — target HTTP profile only; not G0 exit.**  
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
- Independent Maven integration tests in the existing stock-change sample cover actual create 201, GET/PATCH 200, 400, 401, 403, 404, 409 and atomic concurrent stock adjustment. They do **not** assert missing-handler 501 on this app (a real domain handler is installed); 501 remains documented from the existing generated controller and separately exercised in the earlier init-java scaffold experiment.
- **Explicitly not completed by this PR:** new typed Resource/View/Capability/Effect IR, pagination/query parameters, ui/capability/generation manifest projections, external Spectral/oasdiff tooling, complete error serialization/headers parity, OpenAPI Generator 7.26.0 replacement, Orval/Kubb client, JWT/OIDC and RJSF. Those remain gates.
- Historical default OpenAPI v0.2 intentionally still advertises Bearer/200; consumers must opt into the target projection and must not mistake the default for this Java target. A later versioned compiler evolution will make target-scoped output the standard supported path.
- Do not claim a production API identity provider: Basic is a local demonstration profile.

## Upstream references

- [OpenAPI 3.1 HTTP security schemes](https://spec.openapis.org/oas/v3.1.0.html)
- [Spring Security HTTP Basic](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/basic.html)

## Verified free deployment and source evidence (2026-10-12 UTC)

- **Tested source branch commit:** `2ea2ecb6b8ac52833e599b06a0a11f27e591512b`. Dockerfile: [deployment/product-stock-change/Dockerfile](../deployment/product-stock-change/Dockerfile).
- **Render Free:** service `srv-db66d3qd0e5s739ige00`, deploy `dep-db66d42d0e5s739igfi0`, status **LIVE**. Git commit in Render deployment matched tested SHA.
- **Python:** 26/26 tests from `test_java*.py` PASS (**7 new HTTP-profile tests + 19 previous Java generator/project tests**); 4/4 inventory-template tests PASS. The generation shell actually produced `contract-http/openapi.json` (5 target artifacts).
- **Java 21 / Spring Boot 4.0.2 / Maven clean verify:** generated stock-change app **BUILD SUCCESS, JUnit 3/3**; isolated direct-code app **BUILD SUCCESS, JUnit 3/3**, zero failures/errors/skips in both. Builds executed HTTP integration tests, including stock authorization, bad input, domain errors and concurrent increments. Note this is the existing Boot 4.0.2 target, NOT the planned upstream Boot 4.1.1/G1 candidate.
- Generated JAR SHA-256 `e55a0f94e1e3090a29669672098165c5d1b65d35590e3d82fe6c70e31ce1d4da`; direct JAR SHA-256 `a6ecb3df7293ed3b234ab9551811af7a9cc04de6a2f3ad5a459ded13aa0ca6b9`.
- **Independent public HTTP probe:** `GET https://protocolia-g0-http-parity-20261012.onrender.com/health` returned `{"status":"UP"}` after deployment became live. An earlier probe during Render startup returned 503; that was not a green health response and is not hidden.
- **Remaining G0:** canonical typed Resource/View/Operation IR extension, deterministic UI/capability/generation manifests, complete per-operation error-body/headers contract parity, OpenAPI 3.1 corpus, Spectral/oasdiff integration, and independent consumer codegen. This gate is explicitly **IN PROGRESS**, not complete.

