# Stage 4 — stock change: pragmatic product value check

This is **not P4** and does not claim a controlled agent benchmark.

**Same user story for both existing Java backends:** implement authenticated
`PATCH /api/books/{isbn}/stock` with JSON `{"quantity": N}`.
- Only positive integer 1..1000 accepted; malformed JSON, absent/unknown fields,
  negative/zero values or nonintegers return 400.
- Atomically increase existing stock and return HTTP 200 plus the updated
  book without losing its ISBN/title.
- Unknown ISBN returns 404; integer overflow returns 409 with no state change.
- Anonymous request returns 401; read-only viewer returns 403 on PATCH and
  can still GET existing books.
- Concurrent requests must not lose updates: 8 x increment of 3 => stock 24.
- Do not modify frozen A/B/C source artifacts or the P4 verifier.

## Two implementation paths

**Contract-driven:** [protocolia/contract.json](protocolia/contract.json),
user-owned [domain handler](protocolia/CatalogHandlers.java),
unchanged source generator, and original catalog regression test.
HTTP routes, request DTO, validation and authorization are generated.
Run from repository root:

```sh
sh examples/stock-change/prepare.sh target/stock-change-generated
cd target/stock-change-generated
mvn -B -ntp clean verify
```

**Handwritten:** [direct/](direct/) is a separate copy of the original
A direct workspace tree (original source Git commit
`46c09bbc06e29775a14ad849e43861d7f459f3a3`).
It is *not* the frozen experimental artifact. It contains direct Java
controller/repository/DTO changes plus baseline alignment of demonstration
security and replacement of incompatible Spring Boot 4 `TestRestTemplate`.

Both run the same stock-adjustment JUnit HTTP assertions (only Java package
names differ) and their respective basic catalog regression tests.
Builds use Java 21/Maven 3.9.11 inside the
[one Docker pipeline](../../deployment/product-stock-change/Dockerfile).

## Interpret any outcome narrowly

The direct baseline originally had **no authentication**; adding equivalent
auth is baseline-normalization work, not fairly attributable to the restock
feature's marginal developer cost. Its original tests also required fixing.
We can compare manual files touched, equivalent HTTP behavior and directly
observed build outcomes, but cannot infer general speedup, ROI or model savings
from one case. Data is in memory, not persisted.
