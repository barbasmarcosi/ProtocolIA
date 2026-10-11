# P4 A — direct candidate Render evaluation (2026-10-11)

**A original Maven build: FAIL.** **Unmodified main source executable JAR when skipping candidate tests: PASS.** **Frozen independent HTTP verifier: PASS.**

- Published candidate: [`46c09bbc06e29775a14ad849e43861d7f459f3a3`](https://github.com/barbasmarcosi/ProtocolIA/commit/46c09bbc06e29775a14ad849e43861d7f459f3a3), source Git workspace tree `2c30c61963753ea022bcd4d73bfc9250b8606843`.
- Top-level Work session provenance: no verified Codex CLI model turn, no exact model/effort/tokens or elapsed duration. `evidence.json` reports zero repairs and zero extra human interventions. **Not a matched preregistered P4 A run.**
- Render `dep-db5kaep42hec7399b61g`: `mvn -B -ntp clean verify` with Maven 3.9.11/Java 21 **FAILS testCompile** on `org.springframework.boot.test.web.client.TestRestTemplate` import absent from declared Spring Boot 4 test dependencies; none of the authored tests ran.
- Render `dep-db5kaqvlot8c73f96fa0`: candidate Git tree unchanged, `mvn -B -ntp -Dmaven.test.skip=true clean package` **BUILD SUCCESS**, standard Spring Boot executable JAR `042a699ce3f468d4c5379f8d3aa5a09d84ded5dd03397e0ee5af9bb7691d2ce5`, backend deployment **LIVE**; startup through `java -jar`.
- Separate Render independent grader reused the originally pinned verifier `ProtocolIA-Test@77ec9150fed3b1ae4e80c87befc052e34702af8c`, unmodified grader file SHA256 `3ffe2ff7915a5b5e75bf75f42a2c13631a4b89761f899a9320925bc6117db195`. Operator-owned local-only proxy forwarded to A HTTPS backend. Judge runner commit `087ffd2ef2092f849e0a9b3d87dc25e8ace49742` and Render deploy `dep-db5kbmqd0e5s73fpdifg`. **HTTP verifier PASS, exit 0, security_passed=true**. The live [/verdict](https://protocolia-p4-independent-judge-b.onrender.com/verdict) identifies treatment A and full source commit.

## Completed exploratory matrix

| Measurement | A (direct) | B (conventional) | C (ProtocolIA) |
|---|---|---|---|
| Java source compiles | PASS | PASS | PASS |
| `mvn clean verify` including authored tests | **FAIL** | **FAIL** | **FAIL** |
| Normal executable JAR with tests skipped | PASS | **FAIL** | PASS |
| Backend operational with evaluator-supported launch | PASS | PASS | PASS |
| Original frozen independent HTTP verifier | PASS | PASS | PASS |
| Eligible for matched preregistered Codex CLI metrics | **NO** | **NO** | **NO** |

**Methodological qualifications:** all three evaluations are exploratory top-level Work artifacts with unknown model/time/tokens; no model-cost or iteration comparison is possible. C's ProtocolIA-generated HTTP 501 controller is **not integrated into the runnable Spring app**, and most running C Java sources are Git-identical to B. Therefore this experiment does **not** show ProtocolIA's added value, and three identical passing verdict digests are just hashes of the same pass fields, *not* evidence of the same candidate or independent per-assertion data.

Original candidate source code was not edited for evaluation; tests skipped only in independent build wrappers after native failure was logged. This does not transform the original build failure into success.

Issue #5 stays OPEN; **0 eligible matched Codex CLI sessions**. See [machine-readable evidence](../benchmarks/p4/evidence/20261011-render-a-exploratory/evaluation.json), and separate [B](P4-RENDER-B-EVALUATION-20261011.md) and [C](P4-RENDER-C-EVALUATION-20261011.md) reports.
