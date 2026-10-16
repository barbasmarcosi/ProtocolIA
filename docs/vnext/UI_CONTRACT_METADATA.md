# UX3 — Declarative presentation metadata in TypeSpec

ProtocolIA separates **authoritative domain behavior** from **how that behavior is presented**. A generated application must not require handwritten entity-specific React code for understandable labels, contextual guidance or input controls.

## Contract syntax

```typespec
import "@protocolia/domain";
using ProtocolIA.Domain;

@entity
@view("Monthly performance")
model MonthlyEvaluation {
  @publicIdentity @unique @minLength(1) @maxLength(40)
  @uiLabel("Evaluation number")
  number: string;

  @minLength(7) @maxLength(7)
  @uiLabel("Evaluation month")
  @uiHelp("Choose the month of the evaluation.")
  @uiControl("month")
  @pattern("^[0-9]{4}-(0[1-9]|1[0-2])$")
  period: string;
}
```

| Decorator | Allowed on | Intended effect |
| --- | --- | --- |
| `@uiLabel("...")` | Entity property | Overrides fallback camelCase name in generated forms, summary tables, details and relevant filters |
| `@uiHelp("...")` | Entity property | Describes purpose of a field; emitted as visible field guidance and linked with the input's accessible description |
| `@uiControl("month")` | Seven-character bounded string property | Uses browser month picker in generated create/forms and matching filters; **not** an authoritative date-format constraint |

These properties compile into optional `uiLabel`, `uiHelp` and `uiControl` fields on the canonical technology-neutral `IrField`. The NestJS and Spring generated React frontends use the **same** shared template; the server continues to enforce the independent domain constraints. Missing hints degrade to the previous generalized heuristics to preserve compatibility.

## Fail-closed compiler rules

- `uiLabel`: nonempty, trimmed, one line, maximum 90 characters, no angle brackets.
- `uiHelp`: nonempty, trimmed, one line, maximum 240 characters, no angle brackets.
- `uiControl`: currently only `month`, only on `string` with explicit `minLength(7)` and `maxLength(7)`. Unknown controls and mismatched types fail compilation.
- Decoration on an entity's persisted property is presentation-only; generated HTTP/API, SQL, permissions, migrations and business logic remain unchanged.
- Presentation labels never substitute for public identity values in foreign keys.

The independent volunteer-evaluations TypeSpec contract uses these annotations for sections, guards, volunteers, evaluations and leave records. Its source-frozen business requirements, persisted schema and frontend/browser tests remain separate. Mutation tests assert invalid display annotations fail at the compiler; the real browser asserts declared captions and descriptions on generated controls.

## Deliberate scope boundary

`@uiControl("month")` does not imply the backend verifies that a string matches `YYYY-MM`. For an **authoritative** year-month invariant, ProtocolIA must implement a domain-level format/regex constraint, validate it consistently in NestJS and Spring Boot, and cover migration/schema/API negative tests. UI-only validation is helpful feedback but never a security or correctness boundary.

Other pending requirements: named enum/choices from formal contracts, cross-page readable relation labels for all summary-table rows (the UX4 generated field picker now pages, searches and hydrates saved selections), field priorities/list representation, structured server-side validation mapping, deep-linkable task workflows and accessible visual regression testing on unrelated contract sets.

## Acceptance

The compiler shall reject invalid hints; both generator targets shall build and retain domain conformance; Chromium shall exercise the UI-generated form, read declared hints through accessible descriptions, create an allowed record and reject invalid numeric constraints without silently persisting it. Screenshots and manual critique remain necessary for visual quality.

## UX4 follow-through — Server-paged relationships

The shared TypeSpec-to-IR-to-React architecture now emits a server-paginated relationship picker when the authorized related dataset exceeds 50. It uses a permitted `listPage` for browsing, a separately declared `queryPage` with the `contains` operator for case-insensitive literal text search, and `get` for restoring existing off-page selections. Both NestJS and Spring Boot apply the same read permissions, SQL-parameter binding and literal wildcard escaping. Creation and compare-and-swap reassignment share the generic picker. Mobile rendering uses an adaptive bottom sheet after visual review.

Proof is maintained in [UX4_PAGED_RELATIONSHIPS_20261015.md](./evidence/UX4_PAGED_RELATIONSHIPS_20261015.md), with the independent two-backend PostgreSQL/Chromium run #38792714442 and its desktop/mobile screenshots. The current limits on table-label hydration, indexed substring search at extreme scale and server-authoritative `YYYY-MM` validation remain explicit rather than being declared solved.

## UX5 — Domain validation is separate from presentation

The standard TypeSpec `@pattern("^[0-9]{4}-(0[1-9]|1[0-2])$")` now compiles to the technology-neutral `IrField.pattern`. Both NestJS and Spring Boot reject invalid input and invalid typed period filters; PostgreSQL enforces matching `CHECK` constraints. The original `@uiControl("month")` remains only a hint and never creates a validation permission or invariant by itself.

Only the exact, portable, anchored year-month pattern is supported in this increment. Arbitrary regular expressions are rejected until a safe cross-language compiler subset exists. Existing schemas are tightened with a versioned, transactional and data-preserving `addPattern` migration; the generator preserves the immutable old baseline and rejects older rows that violate the new constraint without rewriting them. Full tests and release evidence: [UX5_YEAR_MONTH_20261015.md](./evidence/UX5_YEAR_MONTH_20261015.md).


## B1.1 — Native TypeSpec enum fields (domain rules, not UI hints)

TypeSpec string enums on persisted entity properties now compile to `IrField.choices` and remain authoritative from API to PostgreSQL. The shared React generator derives an accessible finite-choice selector and human-readable member labels without application-specific patches. The API and database reject values outside the enum, and the compiler refuses an incompatible plain-string request DTO. Numeric/mixed enums, arbitrary member labels/localizations, automatic enum changes on populated production tables, and full domain-level decimal/conditional expressions remain **unsupported** until explicitly implemented.

This capability is not equivalent to `@uiControl`, whose hints are presentation-only. An enum is a **server-authoritative domain constraint**; changing its members requires an explicit schema-evolution review for existing data.

Concrete validation: [B1.1 TypeSpec enums evidence](./evidence/B1_1_TYPESPEC_ENUMS_20261015.md), generated Nest/Spring/PostgreSQL HTTP and direct SQL checks, plus mobile Chromium.


## B1.2 — Conditionally required string fields from a TypeSpec enum

A field such as `maintenanceReason?: string` may use `@requiredWhen("quality","needs_service")` when `quality` is a declared sibling string enum containing `needs_service`. This is a **domain constraint**: the compiler carries it in the neutral IR, both generated backends validate it on create, PostgreSQL enforces a conditional CHECK against direct writes, and the shared React form indicates and validates the requirement dynamically. The enum trigger may be omitted when optional; the conditional target must be optional and nonnullable in TypeSpec.

Only an equality condition against a **single enum value** and an optional string target is currently supported. Unsafe/unknown rules are rejected by the compiler. Existing-record single-field PATCH of a conditional source/target is explicitly blocked until a transactional rule-aware mutation model exists. No ad hoc SQL or UI-only interpretation is permitted. This does not yet support arbitrary conditions, decimals or automatic database migrations.

Evidence and independent acceptance: [B1.2 conditional required fields](./evidence/B1_2_CONDITIONAL_REQUIRED_20261015.md).
\n## B1.4 — Agrupación y controles desde contratos\n\n`@uiSection("Identificación")` agrupa campos editables en secciones legibles y accesibles. `@uiPlaceholder("Ej.: Aspirante")` aporta ejemplos, nunca valores predeterminados. `@uiControl("textarea")` transforma cadenas simples con `@maxLength(1..2000)` en áreas de texto redimensionables.\n\nSecciones y placeholders son textos de una sola línea, sin etiquetas, con límites 64 y 90 caracteres; TypeSpec rechaza metadatos inseguros. La agrupación conserva el orden de la primera aparición de cada sección y de sus campos. Cuando ninguna sección está declarada, no agrega encabezados. Si hay mezcla de campos con/sin sección, los no clasificados van a «Datos generales».\n\nLos hints solo afectan presentación; NestJS, Spring Boot, PostgreSQL, OpenAPI, reglas de negocio y autorizaciones permanecen independientes. Chromium verifica edición, accesibilidad y capturas mobile/desktop sobre la aplicación generada. No implica soporte para formularios condicionales complejos, rich text o autorización de producción.\n