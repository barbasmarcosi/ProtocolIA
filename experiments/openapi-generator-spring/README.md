# G1 OpenAPI Generator Spring Boot 4 parity spike

Status: **RESEARCH / INTEGRATION PROBE**, not accepted or production-ready.

Source input: generated `examples/books-paging-v03` v0.3 **target-scoped OpenAPI 3.1**, from `protocolia compile-bundle`. This is the same API contract as the verified Java-generator baseline. The historical v0.1/v0.2 targets and frozen P4 study are not modified.

Initial candidate: OpenAPI Generator CLI **7.26.0** (`spring`, `delegatePattern=true`, `useSpringBoot4=true`, `useJackson3=true`); Java 21, Spring Boot 4.1.1 root POM **to be tested**. Keep source generation constrained to APIs and models only. **Never adopt default generated stub returns (501) as a working domain.**

Steps: (1) run and inspect actual generated interfaces and delegate names, (2) implement a user-owned app/domain/auth adapter using only generated API/DTO surfaces, (3) execute the same Books HTTP/JUnit tests including 400/401/403/404/409, 8 concurrent stock changes, (4) verify regeneration and code ownership, (5) compare surface against current baseline. Either document PASS with exact SHA or keep working ProtocolIA Java target as fallback.

The initial Dockerfile is intentionally a generation probe, not a deployed API. Its intentionally failing final command must not be called a deployment failure of a supposed working app.
