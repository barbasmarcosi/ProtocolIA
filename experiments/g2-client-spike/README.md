# G2 — bounded client generator comparison

Orval **8.41.0** vs Kubb **5.5.5** are run on the **same generated Books v0.3 target-specific OpenAPI 3.1**, never on a manually edited specification. Run in disposable `src/generated/orval` and `src/generated/kubb` folders. HTTP `src/api/http.ts` and cache invalidation rules are **user-owned**.

Intended decision: choose ONE generator after measured exact behavior and TS typecheck. The custom fetch adapter injects runtime authorization from the application, not from code generation. Tests will start the G1 Java application locally and exercise real 200/201/400/401/403/404/409 outcomes.

This initial change is a candidate-generation probe; **do not report runtime parity until actual HTTP integration tests have passed**. No P4 benchmark touches or productivity claims.
