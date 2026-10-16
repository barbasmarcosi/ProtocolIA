# B1.2 — Enum-driven conditional required fields

## Semantic contract

This increment adds `@requiredWhen("quality","needs_service")` to an **optional string field** in an `@entity` TypeSpec contract. The condition references a **sibling, explicitly declared string enum value**. It is an authoritative domain requirement, not a UI decoration.

```typespec
enum GaugeQuality {
  Ready: "ready",
  NeedsService: "needs_service",
  Retired: "retired",
}
@entity
model Gauge {
  // ... public identity and ordinary fields
  quality?: GaugeQuality;
  @requiredWhen("quality", "needs_service")
  @minLength(5) @maxLength(160)
  maintenanceReason?: string;
}
```

The rule means: **if** quality equals `needs_service`, maintenanceReason must be supplied as a nonblank string; for other enum values or absent quality, it may be omitted. A supplied reason still follows the declared length bounds.

## Implemented generator behavior

- The TypeSpec decorator is registered in `@protocolia/domain`, compiled into `IrField.requiredWhen`, and rejected for wrong/unknown source, undeclared enum value, self-reference, required/nullable/unique/computed/referenced target, or unsupported source type. No arbitrary expressions or SQL input are accepted.
- A `create` request DTO must contain the optional plain-string target. The compiler rejects attempts to patch either the conditional target or its enum trigger with the existing single-field patch adapter, rather than permit unsafe partial updates.
- The generated NestJS and Spring Boot HTTP implementations both check the condition **before insert**, returning HTTP 400 and structured `issues:[{field:"maintenanceReason",code:"required"}]` when missing, blank or whitespace-only.
- Both PostgreSQL adapters generate a table-level `ck_cond_gauge_maintenance_reason` CHECK using `IS DISTINCT FROM` and `btrim`, enforcing the rule even if SQL bypasses the HTTP API; no persisted row can silently violate it.
- The **shared** React form shows the required marker based on the selected enum and prevents submission while missing; contextual help explains the condition on mobile and desktop. The reusable generator code is modified, not any hand-coded Gauge/Bomberos screen.

## Validation and scope

Fixture: `examples/vnext/finite-choices`, deliberately distinct from the live volunteer-evaluations schema. Compiler mutation tests: `tests/vnext/finite-choices.test.mjs`. Black-box HTTP/PostgreSQL/Chromium oracle: `scripts/vnext/probe-finite-choices-http.mjs`.

The acceptance criteria are a clean two-backend GitHub Actions run, including direct PostgreSQL rejection of an incomplete record and an actual Chromium mobile create flow. The first isolated run proved both HTTP and browser behavior but **failed only while publishing a screenshot under an incorrect filename**. The follow-up fixes the artifact path; final run status must be recorded before release.

**Not yet supported:** general boolean formulas, nested conditions, conjunction/disjunction, conditional FK requirements, conditional mutation of existing records, remote/offline validation, automatic migrations of an existing populated database, decimal amounts, or workflow-level task screens. A conditional create rule does **not** imply all business policies can be generated.

Deployment safety: do not alter the Railway/Neon volunteer-evaluations demo schema to exercise this independent fixture. Existing data and `main`/PR #52 remain untouched until separately authorized releases.
