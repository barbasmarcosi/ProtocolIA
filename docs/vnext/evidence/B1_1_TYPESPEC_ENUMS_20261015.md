# B1.1 — TypeSpec native string enums, one portable invariant (2026-10-15)

## Objective and implementation

Generated applications should never treat a finite set of domain states/categories as an unrestricted free-text field. This increment compiles a **real TypeSpec string enum** (not an invented client-only field hint) into the canonical technology-neutral IR, and carries the same declared values into both runnable adapters and the shared generated React frontend.

Example from an intentionally **independent, disposable Gauge fixture**:

```typespec
enum GaugeQuality {
  Ready: "ready",
  NeedsService: "needs_service",
  Retired: "retired",
}
@entity
model Gauge {
  // ... normal public identity and other required fields
  @uiLabel("Estado de conservación")
  quality?: GaugeQuality;
}
```

Semantics:
- Compiler accepts only string enums with **2–16** distinct, safe, explicit lowercase identifier-like values of up to 64 characters. Numeric, mixed, unsupported and duplicate enums fail closed; no string coercion. Public identities and FK fields cannot silently switch to enum behavior.
- IR `IrField.choices` contains `[{value,label}]`. The backend uses the **value** as authoritative; label is human-facing and currently derived from the TypeSpec member name. Domain enum values are never substituted by captions in SQL/HTTP.
- NestJS and Spring Boot validate enum membership before SQL. Invalid string values produce HTTP **400** and a contract-scoped structured `issues:[{field:"quality",code:"invalid_choice"}]`; incompatible types return `invalid_type`.
- Both PostgreSQL adapters emit an actual `CHECK (column IN (...))` with safely compiled literal values. Optional enums permit an omitted input; persisted values survive restart. 
- Generated React uses the existing keyboard-operable accessible Radix selector, including translated field caption, required/error semantics, mobile viewport constraints, and display labels in list/details.
- Compiler compares an enum-bearing CREATE/PATCH request DTO with the entity enum, rejecting an unconstrained body `string` as `protocolia-enum-request-mismatch`. Transitions cannot use values outside a declared enum.
- This is a **generic feature in the compiler/adapters/React template**, not a handwritten Gauge or Bomberos UI.

## Release proof and boundaries

Targeted isolation: `examples/vnext/finite-choices/` cloned as an independent validation domain based on the pre-existing Gauge shape. Its string enum is present on the persisted entity and HTTP request. `tests/vnext/finite-choices.test.mjs` mutates invalid contracts. `scripts/vnext/probe-finite-choices-http.mjs` runs both generated apps with temporary PostgreSQL, exercises auth, valid and invalid writes, restart persistence, and optionally real Chromium on 390×780 mobile. The CI workflow creates both generated apps without patching their output.

**Scope limitations:** this increment does not implement arbitrary decimal math, cross-field calculations, open-ended enum member metadata/localization, dynamic enum catalogs, or migrations from older unrestricted string columns on populated production databases. Do **not** add enum constraints to the deployed Bomberos LeaveRecord schema without a separately versioned, data-preserving evolution plan and source requirement confirmation. The Railway volunteer demo remains on UX9 during B1 isolated acceptance. Production IAM and complete scoring remain unsupported.

**Release gate:** mark complete only when exact final code passes both generated Nest and Spring HTTP/PostgreSQL oracles and Nest mobile Chromium, plus quality. Remove temporary CI when that gate is conclusive; preserve links and traceable SHA in the final evidence update.
