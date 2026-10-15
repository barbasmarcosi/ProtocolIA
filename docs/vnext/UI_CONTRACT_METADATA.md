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

Other pending requirements: named enum/choices from formal contracts, human-readable relation values beyond the first 50 records (server-paged searchable picker), field priorities/list representation, structured server-side validation mapping, deep-linkable task workflows and accessible visual regression testing on unrelated contract sets.

## Acceptance

The compiler shall reject invalid hints; both generator targets shall build and retain domain conformance; Chromium shall exercise the UI-generated form, read declared hints through accessible descriptions, create an allowed record and reject invalid numeric constraints without silently persisting it. Screenshots and manual critique remain necessary for visual quality.
