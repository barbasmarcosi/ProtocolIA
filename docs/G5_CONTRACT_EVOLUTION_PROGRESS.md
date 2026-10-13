# G5 — Contract evolution & full-stack regeneration

**Status: IN PROGRESS; pilot scope only.** Initiated 2026-10-12 from
`main` `64937baaa6b34951de881c136432354070fa8b00`.
The historical G0–G5 code and frozen P4 experiments remain intact.

## Implemented E1: v0.4 bounded nullable-field semantics

- New strictly validated `version: "0.4"` with only **optional and nullable**
  scalar fields: `{"type":"datetime","required":false,"nullable":true}`.
  Missing and explicit null both map to Java null. Optional-but-nonnullable,
  required-nullable and nullable collections/references are **unsupported and
  rejected**, not falsely described as equivalent.
- OpenAPI 3.1, JSON Schema Draft 2020-12 and TypeScript emit the nullable
  union; the Java-target adapter accepts this bounded record shape.
- Versioned `resources.json` sidecar v0.3 preserves the existing role,
  field and capability bindings.
- `examples/books-evolution-v04/` adds `publishedAt` to BookRequest and
  Book plus create/list/detail metadata, without mutating the existing
  deployed G1/G2/G3/G4/G5 Books contract.
- `tests/test_v04_evolution.py` covers deterministic output, compatibility,
  null/omission payload semantics and negative unsupported cases.
- A disposable Docker probe under `experiments/g5-contract-evolution`
  builds the OpenAPI Generator 7.26.0 Java target and Orval 8.41.0 React
  client against that new fixture. **This build is not evidence of functional
  nullable-field persistence or browser behavior.**

## Evidence tracking

GitHub feature branch:
`feature/g5-contract-evolution-regeneration`.
Python, Java and TypeScript validation must be confirmed from an observed
test log at an exact source commit. Tests added to the repository are not
automatically considered passing. The final public image, when built, exposes
only GET /health and no writable Books API or PostgreSQL instance.

## Next acceptance steps — E2

1. Validate the v0.4 projection with actual Java HTTP and Playwright tests
   for omitted/explicit-null/valid timestamp/invalid timestamp.
2. Add reviewed user-owned Flyway V2 nullable `published_at`, JDBC and
   delegate mapping. Test writes, rollback, and two-JVM restart with PostgreSQL.
3. Implement safe staged regeneration across owned Java, Orval TypeScript,
   JSON Schema, RJSF, UI/capability manifests; reject collision/tampering;
   preserve all handwritten source and user-owned migrations byte-identically.
4. Add same-version compatibility and negative breaking fixtures, a second
   resource, and deterministic second-generation comparisons.
5. Integrate a real secured persistent Books service in nonproduction only
   after JVM, browser, policy and DB acceptance passes. Keep P4 empirical
   savings claims blocked until matched independent measurement.

No paid model API, GitHub Actions minutes, production database migrations,
or autonomous writes were authorized by this pilot.
