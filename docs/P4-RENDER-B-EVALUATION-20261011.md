# P4 — Published B candidate evaluated on Render (2026-10-11 UTC)

**Independent HTTP test: PASS**. **Original build `mvn clean verify`: FAIL**.
**Original executable JAR startup: FAIL**. **Preregistered matched Codex B trial: NOT ELIGIBLE.**

Published candidate source: `barbasmarcosi/ProtocolIA`, `benchmarks/p4-b-catalog-crud-r01`, publication SHA `13596c5e499b918a36c8becc549d3b8b5ddb9b8b`; the complete candidate workspace Git tree is **`85a1ea836de328fa7785ed81506f11713058717d`**, copied verbatim into an isolated Render build branch. The claimed original local SHA `7a324c153ffb1c47731cfe14b9a959871b0cbae5` is not resolvable on GitHub; treat it as a self-reported local commit identifier, not independently verified history.

The published `evidence.json` explicitly states this came from a top-level ChatGPT Work session, **not a successful Codex CLI model turn**, and that model, reasoning effort, tokens, and wall-clock time are unknown. Do not count as a preregistered B attempt, or compare costs/durations with C/A. No API keys were used here.

## Reproduction observations (original candidate files never changed)

| Render deploy | Method | Actual outcome |
| --- | --- | --- |
| `dep-db5igh8473hc73b9v0f0` | Java 21, Maven 3.9.11, `mvn clean verify` | **FAIL** in `testCompile`: `org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc` missing for declared Spring Boot 4 setup; no unit tests ran |
| `dep-db5ih62jnfac73ak6t50` | Maven package with `-Dmaven.test.skip=true`, then `java -jar` | Build **PASS**, deploy **FAIL**, `no main manifest attribute` |
| `dep-db5ii4o473hc73ba4geg` | Same unchanged sources, `-Dmaven.test.skip=true`, `dependency:copy-dependencies`, `java -cp ... com.protocolia.catalog.CatalogApplication` | Deploy **LIVE**, `GET /actuator/health` returns HTTP 200 `UP`; JAR SHA256 `290aad70784f64e61a90c9f7ff668bf0475b2bba3a164bf720fc6d3a662571dc` |

All packaging and startup differences belong strictly to the **evaluator-controlled Dockerfile**, not the candidate tree. Skipping test compilation to obtain runnable bytecode does **not** turn the original build into a PASS and does not repair the candidate. The source `pom.xml` uses OpenAPI Generator 7.20.0 with `openapi-yaml`; logs confirm plugin execution, but **not** generation of Spring API/controller source. Treatment fidelity as a full conventional code generator has not been demonstrated.

## Independent frozen verification

A separate **Render Free** service from `barbasmarcosi/ProtocolIA-Test`, based on pinned judge commit `77ec9150fed3b1ae4e80c87befc052e34702af8c`, ran its **unchanged** `tools/p4_verify.py` (Git blob `2e61191acce8af8b6290413946ffa5a73b239553`; byte SHA256 `3ffe2ff7915a5b5e75bf75f42a2c13631a4b89761f899a9320925bc6117db195`). The independent operator-owned proxy bound `127.0.0.1:8765`, forwarding HTTP to the warmed candidate's Render HTTPS endpoint, preserving the verifier's exact localhost-only interface and frozen assertions. No evaluator code entered the candidate workspace.

**Actual judge result** (`dep-db5ij5142hec7393rnm0`, judge infra SHA `639268ca6d3ac82829c903cd215dcbfc6c528ba8`):

```json
{
  "verifier_commit": "77ec9150fed3b1ae4e80c87befc052e34702af8c",
  "tests_passed": true,
  "security_passed": true,
  "evidence_sha256": "e15f7f91a5d6db6c2a5abdd3d27afd09fd0b886006672cdcf4c0ae39d0cd10cd",
  "independent": true
}
```

Exit code **0**, stdout `P4 verifier: catalog-crud PASS`. Independently fetched the report from `https://protocolia-p4-independent-judge-b.onrender.com/verdict`.

This is **genuine independent functional evidence for the unmodified B implementation on Render**, *not* proof of conventional-arm end-to-end operational correctness, benchmark comparability or ProtocolIA value. Public Render endpoints and a shared free-hours budget limit isolation/cost claims.

**Study metric remains 0 valid Codex CLI sessions and no comparable B/C/A outcomes.** Issue #5 must remain OPEN; preserve negative build findings alongside HTTP PASS. See the machine-readable evidence in `benchmarks/p4/evidence/20261011-render-b-exploratory/evaluation.json`.
