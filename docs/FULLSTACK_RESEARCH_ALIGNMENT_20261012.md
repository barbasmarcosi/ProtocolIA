# Alignment record — full-stack deep research (2026-10-12)

**Documentary source:** User-supplied report titled **"Investigación profunda: arquitectura de generación full-stack para ProtocolIA"**, dated 2026-10-12. This document is an *implementation decision record derived from that report*, not an independent release audit. The source report was supplied in the conversation, with primary upstream links reproduced below; all numerical version claims in this note are **research-reported candidate pins**, not verified installed dependencies. The source document remains the authoritative rationale; this summary preserves its actionable decisions without embedding session-dependent citation tokens.

**Repository baseline inspected:** main b5bc8455e10a1a7483fb7339107579c29983d471, immediately before this amendment. The first ADR-003 deferred OpenAPI Generator to G4, kept RJSF optional, deferred resource/manifest semantics to G5, and did not require Kubb or Schemathesis early. Those deviations are resolved by the [revised ADR](ADR-003-FULLSTACK-COMPOSITION.md), [requirements](PRODUCT_REQUIREMENTS_FULLSTACK.md), and [reordered G0-G5 gates](FULLSTACK_IMPLEMENTATION_PLAN.md).

## Research decisions translated into the implementation backlog

| Study conclusion | Repo implementation commitment | Evidence gate |
| --- | --- | --- |
| ProtocolIA = semantic contract + compiler + policy/orchestrator, not another code generator | Preserve versioned validated IR and one source of truth | G0 deterministic IR/contract |
| OpenAPI 3.1 is the interoperable API boundary | Derive truthful HTTP statuses, auth, errors and stable operationId | G0 OpenAPI-to-real-HTTP parity |
| Spring Boot 4.1.1 / Java 21 / OpenAPI Generator 7.26.0 | Move replacement parity spike from old G4 to new G1; generated API/DTO/delegate only | G1 Maven/JUnit/HTTP, no shadow controller/501 |
| Orval 8.41.0 vs Kubb 5.5.5 | Both evaluated on same limited fixtures; choose ONE; Kubb's common AST/plugin extensibility matters | G2 TS typecheck, real HTTP, regen diff |
| TanStack Query and RJSF 6.7.1 | Mandatory pilot for typed cache + schema-driven BookRequest and adjustment forms | G2/G3 browser and invalidation |
| Resources/Views/Capabilities/Effects should be typed in IR and emitted as manifests | Resource mapping, ui-manifest, capability-manifest, generation-manifest from G0 | G0 validation and G3 behavior |
| Refine Core and API Platform Admin as optional, Inferencer not core | Short G3/G5 comparison only if value demonstrated | No contract deformation for admin parser |
| Spectral 6.17.0 / oasdiff 1.11.7 | Contract gates, plus ProtocolIA-only capability-breaking semantic diff | G0 lint/diff fixtures |
| Schemathesis 4.30.1 | Required bounded API test gate before completed pilot | G4 actual service testing |
| OAuth2 Resource Server + business capability mapping | Separate protocol capability from IdP/OAuth scopes; server enforcement | G4 issuer/audience/signature tests and allow/deny |
| DB-first (Hasura, PostGraphile, PostgREST, Prisma/ZenStack) deferred | Avoid duplicate API/domain/auth sources with Spring | No DB-first library in pilot |
| Entire generated trees replaceable; handwritten code separate | Stage/validate then replace only generated roots; no skipOverwrite workaround | G1/G5 zero handwritten edits |
| OpenAPI 3.1 features vary among tooling | Corpus includes optional, null, enum, oneOf/anyOf/allOf, nested refs, security, error responses | G0-G2 fail-closed fixtures, no pretend support |
| P4 research evidence is separate | Product-first real runnable pilot, no model-token or USD superiority claim | Explicit P4 no-touch |

## Decisions that are not yet proven

- Candidate releases and compatibility are as stated by the source report, but versions must be checked against *official release docs, license and executable smoke output* before adoption. Boot 4 / Jackson 3 options and OpenAPI 3.1 handling are especially important.
- OpenAPI Generator's mapping from scopes to @PreAuthorize does not automatically implement ProtocolIA business capabilities. Need a server-side mapper verified against role/scope/JWT allow-and-deny tests.
- A valid OpenAPI schema does not automatically imply correct domain transactions, SQL, safe persistence, premium UX, client cache invalidation or correct field/nullable handling.
- Provider-free operation and no GitHub Actions minutes remain a constraint of project execution; the study's GitHub Actions pipeline is a *future design*, not a mandate to spend unavailable CI minutes.
- Numeric targets from the research (30% faster contract-to-green, 40% fewer manual plumbing LOC, 80% automatic CRUD fields) are experiment criteria, not measured savings.
- Tool selection remains PROPOSED until each gateway actually succeeds. Negative outcomes must be recorded and keep the existing functioning implementation as fallback.

## Primary upstream references for verification

- [OpenAPI Specification](https://spec.openapis.org/oas/) and [OpenAPI Generator Spring](https://openapi-generator.tech/docs/generators/spring/) — semantics, delegatePattern / Boot 4 / Jackson flags.
- [OpenAPI Generator release history](https://github.com/OpenAPITools/openapi-generator/releases) — selected 7.26.0 candidate.
- [Spring Boot](https://spring.io/projects/spring-boot) and [Spring Security JWT](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html).
- [Orval](https://orval.dev/) and [Kubb](https://kubb.dev/) / [Kubb releases](https://github.com/kubb-labs/kubb/releases) — generated TS client/hooks and extensible plugins.
- [RJSF](https://rjsf-team.github.io/react-jsonschema-form/docs/) / [releases](https://github.com/rjsf-team/react-jsonschema-form/releases).
- [Spectral](https://github.com/stoplightio/spectral), [oasdiff](https://www.oasdiff.com/), [Schemathesis](https://schemathesis.io/).
- [Refine](https://refine.dev/core/docs/), [API Platform Admin](https://api-platform.com/docs/admin/), [React Admin](https://marmelab.com/react-admin/).
- [PostgREST](https://docs.postgrest.org/), [PostGraphile](https://postgraphile.org/), [Hasura](https://hasura.io/docs/) — alternative DB-first architectures, not dependencies.

## Document history and precedence

The revised ADR and G0-G5 plan supersede the full-stack *proposals* first added in PR #39. Historic product-first Stage 1-4 and P4 reports remain unchanged evidence. The next engineering task is **G0**, not an automatic switch to upstream Java generators without parity evidence.
