# ProtocolIA — Independent external volunteer evaluations pilot (2026-10-14)

**Data source:** external user-uploaded `Taller III PSC.docx` (3 pages), containing real community-service requirements for evaluating volunteer personnel. The source document, people's names, roster identifiers and photographs were NOT copied into this repository. This pilot uses fictional personnel and generated fixture identifiers only. This benchmark is NOT a renamed ProtocolIA Taller or Facility Maintenance sample.

**Immutable requirements BEFORE generation:** [ACCEPTANCE_FREEZE.md](../../../examples/vnext/volunteer-evaluations/ACCEPTANCE_FREEZE.md), 16 BV cases. **Contract:** [contracts/main.tsp](../../../examples/vnext/volunteer-evaluations/contracts/main.tsp). Neither the frozen requirements nor the domain-specific oracle was created from generated IR. No per-entity controller, SQL or React patches were applied.

## Exact empirical acceptance

- Source SHA: [`af41c6a9c274348f92748de7dac19bafb067158c`](https://github.com/barbasmarcosi/ProtocolIA/commit/af41c6a9c274348f92748de7dac19bafb067158c)
- Workflow: [public Actions #38663626317](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38663626317) — **SUCCESS**, both generic and independent probes in the *same* job.
- Official TypeSpec 1.17.0 → framework-neutral canonical IR + OpenAPI 3.1 → generated NestJS + React build: `PROTOCOLIA_APP_BUILD_SUCCESS`.
- Generated Docker Compose configuration, live generated NestJS server on actual PostgreSQL with demo read/write permission isolation: `PROTOCOLIA_COMPOSE_HEALTH_PASS`, `PROTOCOLIA_STATEFUL_CONFORMANCE_PASS`, `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`. Database test project/volume destroyed afterward.
- A separate **black-box source-driven HTTP/PostgreSQL oracle** at [`scripts/vnext/probe-independent-volunteer-http.mjs`](../../../scripts/vnext/probe-independent-volunteer-http.mjs) obtained `BV_INDEPENDENT_FROZEN_ORACLE_PARTIAL_PASS`, asserting:
  - BV-04/05/06: accepted combined category boundary 25/35/20/20, rejected 26/36/21/21, negative and fractional int32, through real POST and persisted GET.
  - BV-01 partial: missing auth 401, demo reader write 403.
  - BV-02 partial: 3-hop FK chain, duplicates 409, missing FK 400, guard reassignment CAS 200/stale 409/reader 403.
  - BV-03 partial: separate persisted historical months and another volunteer, exact filtered paged result (total=1), bounded query validation 400.
  - BV-13 partial: writer-only audit includes initial score fields and published-status event; reader gets 403.
  - BV-16 partial: state publication 1×200+9×409 in 10 concurrent requests; status, reassignment and leave record retained after generated app restart on PostgreSQL.
  - BV-09/10 **storage ONLY**: medical leave period (10 days) persisted, no generated/claimed leave score; original 16.7-point calculation NOT tested/implemented.
- Prior first build [Actions #38662989028](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38662989028) SUCCESS compiled from initial independent contract. A superseded intermediate workflow was cancelled by the branch concurrency policy, not a failed correctness gate.

## Provisional source requirement accounting (no inflated 16/16)

| BV ID | Verdict | Reason |
| --- | --- | --- |
| 04, 05, 06 | **PASS bounded backend** | All three original maximum categories and integer bounds tested through HTTP/DB |
| 01, 02, 03, 13, 16 | **PARTIAL** | Core HTTP/DB behavior tested; row ownership, editing, exports, full UX, user management not covered |
| 09, 10 | **PARTIAL storage ONLY** | Persisted input without correct historical/medical calculation |
| 07, 08, 11, 12, 14, 15 | **UNSUPPORTED or NOT VERIFIED** | Cross-field/source-limited editing, auto total, extraordinary leave exclusion, other-score authorization, download drilldown, identity management |

An externally usable **complete** personnel evaluation system is NOT produced from this contract yet. Requirements on leave calculations, computed monthly totals, field-level roles, export, and time-valid period uniqueness remain product work. No independent human UAT and no publicly accessible live deployment are verified.

## Hosting scope

A reproducible [Nest/React Render Dockerfile](../../../deployment/volunteer-evaluations/Dockerfile) exists **as source** but no Render build/LIVE gate has passed. A separate Neon project named `protocolia-volunteer-evaluations-demo` was provisioned, with no real personnel data. Transferring Neon credentials directly into Render was blocked by a connector security control; this boundary will not be bypassed. The user must configure the Render database connection using the service dashboards or another approved secret handoff before this becomes a public running demo. Never claim Neon project existence is proof of Render deployment.

`main`, PR #52, TrueMaestro and GastroApp remain untouched.

## Next milestone — reusable contract-defined bounded sums PASS ×2 (2026-10-14)

**Verified exact functional SHA `45aead071fae5b0a7cd981d7f6c8b62fadff4d15`** at [Actions #38667823489](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38667823489): all jobs **SUCCESS**. Fresh source TypeSpec → IR → Spring Boot 4/Java 21 + NestJS/Node 24 → React/Vite → genuine PostgreSQL 16, Docker Compose, HTTP conformance and *the same source-frozen independent black-box oracle* **PASS BOTH TARGETS**. This is an additional verified user-domain capability, not a revision of the requirements freeze.

New general-purpose `@computedSum("fieldA,fieldB,...")` on a required `int32` output field uses bounded, distinct, nonnegative `int32` sources that must fit the 32-bit result. TypeSpec/IR/compiler, both adapters and generated UIs derive the feature without per-entity code. PostgreSQL uses a real `GENERATED ALWAYS AS (...) STORED` column; the two generated APIs never accept client-supplied computed values in CREATE, and React omits the field from editable forms. The independent oracle verified HTTP GET/POST: **100** for 25+35+20+20, **80** for 5+35+20+20; a forged `basePoints=0` is rejected with **400**, and the value survives restart and browser/API projection. Compiler negative tests reject unknown sources, duplicate sources, unbounded sources and impossible declared maxima.

**BV-08 remains PARTIAL**, not PASS: `basePoints` explicitly represents only the four usual attendance/guard/internal categories. It is NOT the complete monthly total; `otherPoints`, six-month historical mean, annual/medical/accident/extraordinary leave rules, rounding and authorized correction continue **UNSUPPORTED**. The original frozen 16-case denominator and pre-existing historical results remain unchanged. `main` and PR #52 are untouched.

## Public deployment result (2026-10-14)

- Created Render Free service [`protocolia-volunteer-demo-20261014`](https://dashboard.render.com/web/srv-db82tsuq1p3s739c8cc0), ID `srv-db82tsuq1p3s739c8cc0`. Deploy `dep-db82ttmq1p3s739c8e5g` **BUILD_FAILED**, before checkout or compilation. Render event `pipeline_minutes_exhausted` and logs explicitly say workspace has exhausted this billing period's build minutes. **No verified live URL.** Do not raise spending limit or upgrade automatically.
- Created isolated Neon PostgreSQL 16 project `protocolia-volunteer-evaluations-demo`, ID `fancy-snow-07921835`, with no real personal or evaluation data. Cross-platform credential transfer to Render was **blocked by security control**, intentionally not circumvented. No credentials are written in the repo/evidence.
- Prepared [Render generated-app Dockerfile](../../../deployment/volunteer-evaluations/Dockerfile). Until a free build-enabled host and an approved, user-provisioned secret path are available, this is **DEPLOYMENT BLOCKED**, not product LIVE.
