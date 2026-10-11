# P4 C — ProtocolIA candidate evaluated on Render (2026-10-11)

**Independent pinned HTTP verifier: PASS.** Original `mvn clean verify`: **FAIL** compiling candidate MockMvc tests. Skipping test compilation allows the unchanged app to produce an executable Spring Boot 4 JAR and start normally. **This is exploratory out-of-study evidence, NOT a preregistered Codex CLI C run.**

## Source and treatment provenance

- [C publication](https://github.com/barbasmarcosi/ProtocolIA/commit/2cc3d6938c64b65f281ee10396f460d6dea13781): `2cc3d6938c64b65f281ee10396f460d6dea13781`; immutable `workspace/` tree `b08a7206ee3357eef9198f949c9c47b7d45a9489`.
- Its `evidence.json` records model/version/effort/tokens/duration as **null**, because the top-level Work session did not expose them; 1 reported contract-capability repair, 0 human interventions; no successful authenticated Codex CLI generation session.
- [ProtocolIA generator](https://github.com/barbasmarcosi/ProtocolIA/commit/1e4a0370c3902b08b5f3a855d8adc3b0466cab0a) was pinned at `1e4a0370c3902b08b5f3a855d8adc3b0466cab0a`. Published evidence records successful contract validation and generation of ten `java-spring/0.3` files. This is an **agent-reported** command/result; the generated files are preserved in the published workspace.
- **Crucial fidelity limitation:** `workspace/protocolia-generated` is **not** the Maven source root for the runnable app. `ContractController` generated there contains HTTP 501 placeholder handlers, not the implemented business semantics. Running `BookController` and supporting code are manually authored. Comparing the B and C Git blobs yields **7 of 8 core Java files byte-identical**, including `BookController`, `BookCatalog`, `Book`, `BookRequest`, `CatalogApplication`, and exception classes; only `ApiErrorHandler` differs. This functional similarity prevents attributing HTTP success to the ProtocolIA generator.

## Render observations — no candidate source edits

| Deploy ID | Action | Result |
| --- | --- | --- |
| `dep-db5j3i942hec7395juig` | Same Java 21/Maven 3.9.11 build image as B; `mvn -B -ntp clean verify` | **FAIL** in `testCompile`: import `org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc` missing; no MockMvc tests executed |
| `dep-db5j40flk1mc73a6k0u0` | `mvn -B -ntp -Dmaven.test.skip=true clean package`, launch by normal `java -jar` | **BUILD SUCCESS / DEPLOY LIVE**; Spring Boot 4.0.2, Java 21.0.12.1; `GET /actuator/health` HTTP 200 `UP`. Executable JAR SHA-256 `b8035a73514b84c8df123bdf8021e489bc95779b2e919576220aa6552064eb18` |

Both builds used the **identical C Git workspace tree**, copied unchanged into the evaluator's isolated deploy branch. The only difference is evaluator-owned Docker build command to bypass *noncompiling tests*; this must never be recorded as a passing original build.

Compared with the [B evaluation](P4-RENDER-B-EVALUATION-20261011.md), **both** fail the same test compile; **C** builds a normal executable Spring Boot JAR when tests are skipped, whereas **B** required evaluator-owned classpath assembly and invocation after its bare JAR failed with missing main manifest. This packaging improvement belongs to the manually configured Spring Boot Maven plugin; there is no causal evidence it came from ProtocolIA's generated output.

## Independent black-box verifier

Reused the two existing free Render services (candidate `srv-db5i31ad0e5s73fi66ug`; judge `srv-db5ij4p42hec7393rn2g`), with **no change** to original pinned `ProtocolIA-Test/tools/p4_verify.py` from `77ec9150fed3b1ae4e80c87befc052e34702af8c`.

Python grader source byte SHA-256: `3ffe2ff7915a5b5e75bf75f42a2c13631a4b89761f899a9320925bc6117db195`.
The operator-owned loopback proxy points to C on Render HTTPS; judge runner commit `a38d7ed13612037234c13434fa8c874eeb1b0fa0`, judge Render deploy `dep-db5j50h42hec7395p650`. The original grader's loopback restriction, hidden random data and assertions were not modified.

```json
{
  "verifier_commit": "77ec9150fed3b1ae4e80c87befc052e34702af8c",
  "tests_passed": true,
  "security_passed": true,
  "evidence_sha256": "e15f7f91a5d6db6c2a5abdd3d27afd09fd0b886006672cdcf4c0ae39d0cd10cd",
  "independent": true
}
```

Judge exit code **0**, stdout `P4 verifier: catalog-crud PASS`; separately fetched the [C result from Render](https://protocolia-p4-independent-judge-b.onrender.com/verdict). The URL retains its original “-b” hostname because an existing independent judge service was reused, but the endpoint's `treatment` and `source_commit` fields identify **C**.

**Important:** B and C have the same `evidence_sha256` because the frozen verifier hashes only the same four-result PASS JSON object, **not** the identity of the running candidate. Do not interpret this equality as independent proof of code identity or evaluator replay; separate candidate tree/deploy IDs and judge runner identity provide attribution. The public temporary endpoint currently displays C instead of B; the historical B result is preserved in GitHub.

**Conclusion:** Verified functional C HTTP success of a mostly manual backend, with an original test-build failure. **No preregistered model-run C evidence**, no reliable latency or token comparison. Study still has **0 eligible Codex CLI model sessions**, and **no ProtocolIA benefit is established**. See [structured record](../benchmarks/p4/evidence/20261011-render-c-exploratory/evaluation.json).

Issue #5 remains OPEN. Do not cherry-pick the HTTP PASS into an overall benchmark success.
