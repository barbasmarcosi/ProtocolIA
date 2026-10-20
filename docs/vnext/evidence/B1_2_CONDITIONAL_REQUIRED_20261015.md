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

## Isolated empirical acceptance — confirmed

- [Isolated B1.2 integration #38834001072](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38834001072), source `0af1a1b37087b8fad9263d5d5f39f3044dcb0576`: **both generated NestJS + Spring Boot PostgreSQL jobs SUCCESS**. The preceding attempt #38833739251 passed application oracles but failed **only** because the screenshot upload path was wrong; it was fixed and the gate rerun successfully.
- HTTP oracles explicitly rejected missing, empty and whitespace-only conditional reasons with `400` and `{issues:[{field:"maintenanceReason",code:"required"}]}`, preserved allowed reasons after write/restart, and permitted other enum values without that field.
- A direct PostgreSQL `INSERT` of `needs_service` without a reason failed specifically on constraint `ck_cond_gauge_maintenance_reason`. The rejected row was not persisted.
- Real Chromium at 390×780 submitted an incomplete conditional form, saw the required field error without navigation or insert, completed its reason, submitted successfully and fetched the exact persisted value; marker `PROTOCOLIA_B1_ENUM_BROWSER_PASS` included `conditionalRequired:true,mobile:true,jsErrors:0`.
- Visual screenshot was preserved in Actions artifact **`protocolia-b1-generated-conditional-mobile`** (ID `12017753704`).
- The full integration is isolated from the Railway/Neon volunteer-evaluations dataset. The existing demo is not automatically migrated or redeployed.

## Promotion and official compatibility evidence

- Advanced `independent/volunteer-evaluations` by fast-forward to commit **`a6f887a6ab38c177441ff29bf875bb0f4b7d52bd`**, which contains the tested B1.2 compiler/adapters/React and the independent contract probe, with the temporary staging workflow removed.
- [Official independent volunteer evaluation gate #38834384425](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38834384425) **SUCCESS**: both generated NestJS and Spring Boot projects passed PostgreSQL and source-frozen HTTP oracles; Nest also passed its existing Chromium UI regression plus the separate TypeSpec finite-choice conditional compiler tests.
- [Official quality gate #38834384427](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38834384427) **SUCCESS** at the same source SHA.
- The only public Railway service remains pinned to previously validated UX9 code; its Neon dataset and baseline schema are deliberately unchanged. B1.2 is now **implemented and integrated in the shared generator**, but its conditional demo remains the independent ephemeral Gauge test, not the Railway volunteer app.
