# Independent ProtocolIA demo — Railway + Neon live evidence (2026-10-15 UTC)

## Deployment identity and safety

- Source: `barbasmarcosi/ProtocolIA`, branch `independent/volunteer-evaluations`, contract `examples/vnext/volunteer-evaluations/contracts/main.tsp`.
- Railway project `protocolia-volunteer-demo` (`d8dc4e7d-8939-4633-9844-e2b807fdb2dc`), production service `volunteer-evaluations-web` (`c5c1eab4-ed32-4e0c-beb1-5bd6315b56aa`).
- Public URL: https://volunteer-evaluations-web-production.up.railway.app/ .
- Container built **directly from the independent TypeSpec contract** with `deployment/volunteer-evaluations/Dockerfile`, target NestJS/React; generated PostgreSQL schema; no entity-specific controllers or views manually patched for this demo.
- Neon dedicated Postgres 16 project `protocolia-volunteer-evaluations-demo` (ID `fancy-snow-07921835`); Railway variable `PROTOCOLIA_JDBC_URL` confirmed present with contents redacted. Do not commit credentials, personally identifying data, or screenshots of real personnel.
- Railway deployment `9ef1cac6-5448-44d6-8dd3-412de437e58a` reached **SUCCESS** after the user entered `PROTOCOLIA_JDBC_URL`. Healthcheck path `/health` succeeded; Nest log `PROTOCOLIA_NEST_STARTED` reported five entities and 20 operations.
- Redeployment `02925374-c5b0-42c2-85e3-6e9637e66b69` reached **SUCCESS**; after restart Neon retained the seeded relationship and computed values.
- Railway service configured to sleep when inactive to limit free-credit consumption, and GitHub change watch patterns constrained to the runtime/source/contract and lockfiles, rather than evidence/documentation-only pushes. No paid upgrade requested or used.

## Independent public HTTP and browser evidence

- External public fetch of `/`: **React login page** title `ProtocolIA — aplicación generada`, Spanish controls.
- External public fetch of `/health`: **200**, `{\"status\":\"UP\"}`.
- External unauthenticated fetch of `/api/volunteers` and `/api/_protocolia/me`: **401** each, verifying unauthenticated access denied.
- User-directed live browser run [first pass](https://agent.tinyfish.ai/runs/d0d99800-4a2f-40eb-ad0b-24ffc385e1ac): demo administrator login succeeded and Section `SEC-DEMO` was **created through the UI**. Guard creation was NOT proven from the browser: native FK selection was not handled correctly by the browser automation. This may be an automation limitation or UX issue, and must not be misrepresented as a passed user workflow. No real personnel was used.
- To enable domain-wide readback, the missing **fictional** guard, volunteer, evaluation and leave records were inserted via an isolated, idempotent Neon SQL transaction. This is **seed data, not evidence that React created those records**. Direct SQL seed bypasses API audit, explaining the empty audit event panels for seeded evaluations.
- User-directed [second browser read-only verification](https://agent.tinyfish.ai/runs/f34d39c0-4436-42f2-8425-522889a7bf26) successfully signed into the deployed React app and navigated all **five** entity resources: Section `SEC-DEMO`; GuardDuty `GUARD-DEMO` FK to Section; Volunteer `VOL-DEMO` FK to Guard; MonthlyEvaluation `EVAL-DEMO-SEP` and `EVAL-DEMO-OCT`, including details and **computed** `basePoints=80` and `100`; LeaveRecord `LEAVE-DEMO-01`, 10 medical days without claiming a calculated leave score. Filter inputs and audit panels rendered; no visual errors observed in read-only navigation.
- SQL inspection confirmed `monthly_evaluation.base_points` is a real PostgreSQL `GENERATED ALWAYS AS (((incident_points + mandatory_points) + guard_points) + internal_points) STORED` column, never a client-submitted manually trusted number. `other_points` and all leave formulas are **not** included in `base_points`.
- Neon SQL re-query **after Railway redeploy**: September 2026 = 80, October 2026 = 100; person/guard/section FK chain intact. This is DB persistence across an application redeploy, not a backup/restore exercise.
- Independently, [CI #38667823489](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38667823489) had passed generated NestJS **and** Spring Boot Docker Compose, PostgreSQL, HTTP auth, bounded sum, forged-value 400, and source-frozen independent oracle on isolated environments. This CI evidence is separate from the live Railway test.

## Remaining honest gaps

- Browser **create/edit FK-dependent entity workflow** through React (one automated browser had trouble operating the relation selection) needs manual UAT or a robust alternate browser automation; read-only detail verification alone does not close it.
- Production OIDC/JWT, row/field/guard-specific authorization, qualified employee roles, monthly uniqueness per person, automatic final total with `otherPoints` and historical/medical/accident/extraordinary leave scoring, rounding rules, exports and print templates remain unsupported or partial per immutable [requirements freeze](../../../examples/vnext/volunteer-evaluations/ACCEPTANCE_FREEZE.md).
- Demo Basic read/write identities are **test only**, no genuine person records or production use. Public HTTPS and sleeping/free-tier credit do not imply uninterrupted availability or cost guarantees.
- This demo is a **real independent-domain generated running system**, **not** 16/16 implemented requirements. `main` and integration PR #52 remain untouched.
