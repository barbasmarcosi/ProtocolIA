# UX5 — Authoritative year-month contract invariant (staging)

Date: 2026-10-15. Branch: `feature/vnext-authoritative-year-month-20261015`.

## Objective

Upgrade the standard TypeSpec `@pattern("^[0-9]{4}-(0[1-9]|1[0-2])$")` decorator from a frontend-only hint into a backend- and database-enforced domain invariant. No new ProtocolIA decorative decorator is necessary.

The compiler publishes an optional `IrField.pattern`, currently accepting only the well-defined, anchored, portable 7-character year-month subset. Unsupported regexes fail closed at compilation/generation. Both NestJS and Spring Boot validate string bodies and typed query parameters; their PostgreSQL schemas create equivalent anchored `CHECK` constraints. The shared React client retains its date control as an ergonomic reflection of the constraint, not as the authority.

The frozen volunteer evaluation example applies the domain constraint to evaluations and leave records, including matching request models. An unrelated FacilitySearch contract probes the same generator's SQL and IR behavior. Negative HTTP oracles reject months 00/13 and malformed delimiters without persistence.

## Mandatory validation before promotion

- TypeSpec compile, IR invariants and unsupported-pattern mutation tests.
- Build and test both generated backend variants on isolated PostgreSQL.
- Independent frozen HTTP oracle on NestJS and Spring Boot.
- Chromium creation, reassignment, keyboard/focus, desktop/mobile regression.
- Explicit verification of deployment migrations against the live data schema.

## Existing database migration blocker

Modifying a baseline schema definition is **not** an acceptable upgrade strategy for the existing Neon/Railway demo. The Nest runtime checks a baseline digest and deliberately refuses drift; a Flyway baseline is also immutable. Until a controlled, transactional, repeatable **additive migration** is implemented, the tested change must remain on this feature branch and Railway must stay pinned to verified UX4 commit `279dfdbe46755d498a998f52703c98e6555d677f`. Validate legacy records before adding/validating the constraints; never silently delete or rewrite stored evaluations.

This milestone covers a portable year-month regex only. It does not claim arbitrary regex support, locale-aware dates, historical date boundaries, overall evaluation scoring, or blanket UI excellence.
