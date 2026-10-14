# ProtocolIA — Execution State

Historical baseline updated 2026-10-10. G0–G5 bounded full-stack pilot closeout recorded 2026-10-13. P0, P1, bounded P2 and P3-A local action execution and P3-B1 bounded Docker read-only adapter and P3-B2.1 typed read-only broker and P3-B2.2 Ed25519 signer gateway, P3-B3 local host approval service and P3-B4 signed cost ledger are MERGED and independently verified within their bounded scopes. P3 as a whole remains open.

## Product vNext — current authoritative plan (2026-10-13)

**Direction approved; A0 y A1 PASARON en perfil modular mononentidad (2026-10-13). A2 PARCIAL; A3 portabilidad Spring/NestJS y relación multientidad PASS acotadas; P-06 Nest evolution V1→V2 PASS aditivo con PostgreSQL poblada; A5 PASS aditivo Spring y Nest (V1→V2, checksums y datos preservados); A4 PASS acotado en ambos destinos para dos entidades/FK/UI; A6 transiciones contractuales de estado PASS HTTP/PG; A7 reserva, A8 restitución, A9 migración persistida + React Chromium y A10 auditoría transaccional en Spring/Nest PASS acotado con PostgreSQL real.** The user wants **usable systems
from versioned contracts** with no handwritten per-entity backend, SQL or
React code, not token/agent-cost savings.

**Architecture chosen and empirically validated for A0:** TypeSpec +
`@protocolia/domain` + canonical framework-neutral IR + generator
adapters; JHipster 9.4 Spring/React/PostgreSQL quedó **NO-GO contractual** tras pruebas reales. El motor inicial es TypeSpec → IR + OpenAPI3 → generador modular Spring Boot/JDBC + React declarativo; OpenAPI Generator 7.26 emite interfaces/DTO compilados, aún sin delegación HTTP. NestJS 11.1.6 PASS en Taller/Gauge sobre el mismo TypeSpec/IR/OpenAPI, HTTP/PostgreSQL/Chromium; [A3 evidencia](vnext/evidence/A3.md), con Nest evolution in-place P-06 PASS aditivo acotado (evidencia 2026-10-13).

**Authoritative documents:** [requirements](vnext/00_PRODUCT_REQUIREMENTS.md),
[ADR-004](vnext/01_ARCHITECTURE_ADR.md),
[implementation stages A0–A5](vnext/02_IMPLEMENTATION_PLAN.md),
[acceptance matrix](vnext/03_ACCEPTANCE_MATRIX.md),
[runbook](vnext/04_EXECUTION_RUNBOOK.md).

| Stage | State | Exit value |
| --- | --- | --- |
| A0 — TypeSpec/JHipster feasibility | **PASS limitado** — JHipster stock NO-GO, fallback modular GO. TypeSpec/IR/OpenAPI + dos full-stacks independientes (Tool y Gauge) con PostgreSQL16, roles, atomicidad y Chromium verificadas | [Evidencia](vnext/evidence/A0.md); sin merge ni producción |
| A1 — Domain compiler & persistence | **PASS (perfil mononentidad probado)** — Flyway V1 canónico, reuso de DB al reiniciar, bloqueo de checksum alterado, siete primitivas incluyendo delete opcional en Gauge, auth de demo, HTTP+PostgreSQL y concurrencia PASS | [Evidencia](vnext/evidence/A1.md); migraciones V2/OIDC quedan fuera de A1 |
| A2 — Frontend/one-command | **PARTIAL avanzado** — CLI build en Taller/Gauge, HTTP+PG+Chromium y conformance genérica PASS, Compose `config --quiet` oficial PASS; comandos locales `run/test` aislados implementados, todavía sin `docker compose up` verificado por falta de Docker Engine | [Evidencia A2](vnext/evidence/A2.md); falta prueba real Compose up y cierre de UI/browser genéricos |
| A3 — NestJS second target | **PASS funcional acotado** — Taller/Gauge T-02…T-15 y Equipment/Inspection FK 400/409/204, roles, paginación, Chromium y conformance genérica; P-06 evolución aditiva Nest PASS | [Evidencia A3](vnext/evidence/A3.md) y [A5](vnext/evidence/A5.md); sin migraciones complejas |
| A4 — Independent multi-entity system | **PASS acotado (E-01..E-08)** — dos entidades con FK restrict, HTTP 201/400/409/204, React relacional Chromium, roles independientes; segunda variante TypeSpec con etiqueta y fecha opcional recompilada y ejecutada contra DB nueva | [Evidencia A4](vnext/evidence/A4.md); no confundir con migración V2 segura de A5 |
| A5 — Safe evolution/MVP | **PASS aditivo acotado Spring y Nest; producción NO** — `plan/evolve`, ownership SHA, V1 inmutable + V2 sobre PostgreSQL poblado, historiales Flyway/Nest y rechazo de drift de SQL aplicado; extensiones y filas preservadas | [Evidencia A5](vnext/evidence/A5.md); Compose Engine, backups, IAM productivo y migraciones complejas pendientes |
| A6 — Declarative business transitions | **PASS HTTP/PG acotado Spring + Nest** — `@initial`/`@transition`, CREATE inicial validado, SQL update condicionada, carreras 1×200+9×409 en 10 solicitudes por destino, 401/403/404/409, UI actions declarativas compiladas | [Evidencia A6](vnext/evidence/A6.md); botones específicos Chromium y semántica compleja pendientes |
| A7 — Multi-entity transactional invariant | **PASS HTTP/PostgreSQL acotado Spring+Nest** — `@reserve`, conditional stock decrement+child insert atomically; 35/35 Node tests; 7×201+3×409 10-way race, duplicate transaction rollback, auth and generic contract-driven conformance PASS | [Evidencia A7](vnext/evidence/A7.md); no refund/cancellation, distributed workflows, or A7-specific Chromium |
| A8 — Exactly-once cancellation/refund | **PASS HTTP/PG acotado Spring+Nest** — 10 cancelaciones concurrentes con devolución única, rollback overflow, conformance derivada, checksums y regresiones completas | [Evidencia A8](vnext/evidence/A8.md); no workflows distribuidos |
| A9 — In-place evolution A7→A8 | **PASS bounded HTTP/PG/Chromium Spring+Nest** — contrato A7 V1 histórico, DB con filas pobladas y stock, V2 con backfill `active`, API A7 compatible, cancelación React 390px, lector restringido, segundo reinicio; 39/39 Node | [Evidencia A9](vnext/evidence/A9.md); sin producción rolling upgrade ni backups |
| A10 — Contract-driven transactional audit | **PASS bounded Spring+Nest HTTP/PG** — opt-in `@audit` allowed fields on create/transition, actor+before/after+PostgreSQL time, 41/41 Node, TypeSpec negatives, exactly 4 expected WorkOrder entries, zero rejected-operation events, injected audit sink failure rolls back create/state in both targets | [Evidencia A10](vnext/evidence/A10.md); no audit read endpoint/UI, production IAM, retention or DB tamper-proof controls |
| A11 — Consultable audit history | **PASS bounded Spring+Nest real HTTP/PG/Chromium** — `auditPage` from TypeSpec with independent audit capability, 401/403/404/400, paginated identity-isolated journal, React manager visible/reader hidden on mobile; 43/43 Node and TypeSpec negatives PASS | [Evidencia A11](vnext/evidence/A11.md); no authenticated production IAM, audit tamper proof, or in-place A10→A11 evolution |
| A12 — A10→A11 in-place audited history evolution | **PASS Spring/Nest PostgreSQL HTTP/Chromium** — existing A10 binaries/DB seeded 2 WorkOrders and 6 persisted journal rows, `plan/evolve` adds auditPage only (zero SQL), original Flyway/Nest baseline/checksum preserved, historical events and IDs immutable, invalid writer drift rejected, reader denied, manager React history and second startup/no-op PASS | [A12 evidence](vnext/evidence/A12.md); no production rolling cutover, IAM, immutable offsite audit or general migration profile |
| A13 — Blind independent customer acceptance | **13/16 requirements PASS (81.25%), Spring+Nest** — frozen contract 4 entities Site/Machine/Technician/Ticket, three real FK relationships including two ticket FKs, 10-way guarded ticket transitions, audit RBAC, Chromium mobile two reference pickers, restart preserves PostgreSQL. Three required features declared UNSUPPORTED: audited late technician reassignments, cross-site/state/due-date filters, SLA notifications | [Frozen customer requirements](vnext/evidence/A13_REQUIREMENTS.md), [observed evidence](vnext/evidence/A13.md). **External persistent demo and real-user trial NOT RUN**; Docker build marker is not product LIVE |

**Última validación integral vNext:** A13 functional source **`8ac52355bcf68f3d0f120caedaa6b88a3f22f6b2`**, Render Free verification service `srv-db6t203rjlhs7395vjn0` deploy **`dep-db7h1pjbc2fs73f6mshg` VERIFIED LIVE**. Frozen independent contract Git blob `298d95e7ab6c1b1588454921ab71d52ee2d599fd`; 4 entities with 3 FKs, one Ticket with two references, TypeSpec/IR/OpenAPI hashes equal Spring/Nest and compiler/adapter/UI blobs unchanged after freeze. **46/46 Node tests PASS**, all A0–A12 bounded regression gates PASS, and **13/16 (81.25%) new customer requirements PASS** on two real PostgreSQL instances with HTTP/Chromium mobile, authorization/audit, 10-way guarded state race and persistence through app restart. C14 audited reassignment, C15 filtered search and C16 overdue notifications **UNSUPPORTED**. Public Render URL remains *build-marker only*, not the generated customer app; external durable hosting and real-human trial NOT RUN, Compose Engine real NOT RUN, production IAM/backups NOT IMPLEMENTED. GitHub Actions unused; original main unchanged, PR #52 open.

**A13 independent business scenario (newest focused trial):** exact frozen contract blob `298d95e7ab6c1b1588454921ab71d52ee2d599fd`, freeze parent `dc591a00da6f98b2724188ab2cc9b14c89256a63`. Trial build `8ac52355bcf68f3d0f120caedaa6b88a3f22f6b2`, Render Free `dep-db7h1pjbc2fs73f6mshg`. **13/16 customer requirements PASS** on both Spring/Nest real HTTP/PostgreSQL/Chromium; actual browser created objects with 2 FK selectors and operated states/history, ten-way race yielded 1×200/9×409, all original rows and audit persisted across restart. Three customer requirements UNSUPPORTED; no generator/adapter/React template changes after freeze, contract/IR/OpenAPI digests identical between targets. All A0–A12 bounded regressions PASS; Render build and deployment of the exact functional source verified LIVE (build marker only). **Persistent externally accessible generated application not hosted** and therefore no real-user availability claimed. [A13 detail](vnext/evidence/A13.md).\n\n**Evidencia adicional A6:** fuente funcional `662171295990fce1438dd0d507da85cbce3cca22`, Render Free `dep-db7e1gvavr4c73fssp0g` LIVE; 33/33 pruebas Node, TypeSpec WorkOrder real, backend Spring y Nest sobre DB PostgreSQL separadas, cada uno con transición concurrente 1 éxito/9 conflictos, controles 400/401/403/404/409 y SQL constraint. La conformance genérica stateful y tres negativos TypeSpec se revalidaron luego en `dep-db7e4rbbc2fs73es6ab0` LIVE, fuente exacta `86684c9e1db5af88097dff1718805967a92a58e3`. HTTP/PG no sustituye el A6 UI/Chromium aún NOT RUN.\n\n**A7 verified functional evidence:** exact source `ad34b7f2d33c123cfd404d30e12fe18d58ab4a97`, Render deploy `dep-db7eck8473hc73d32jjg`, `35/35` Node, TypeSpec contract/IR, Spring+Nest binaries and shared React build, transactional PostgreSQL stock debit+child insert, duplicate rollback, and competing requests with 7 succeeded/3 declined PASS. `PROTOCOLIA_TRANSACTIONAL_CONFORMANCE_PASS` both targets. Render deploy `dep-db7eck8473hc73d32jjg` terminó **LIVE**, con regressiones A0–A6 PASS. A7-specific Chromium NOT RUN. [Evidence](vnext/evidence/A7.md).\n\n**A9 real empirical evidence:** source `913bcb318724cf2a0bcd12cedf1e609da0c03075`, second Render build `dep-db7euknavr4c73809dmg` checked out `49c63d7a68370376f4e3afe6b8c0f87b88a8943e`. The first build `dep-db7esbo473hc73d4p1pg` was canceled after container registry metadata stalled, before tests. Second build: **39/39 Node** PASS, A7 seed on pre-existing Spring and Nest databases PASS, `app:plan/evolve` compatible with state+operation only, Flyway/Nest V2 histories and byte-identical original baseline, historical row and stock preserved, backwards compatible A7 client body, **Chromium mobile cancellation/stock/read-only role** PASS ×2 and second startup PASS ×2. El deploy `dep-db7euknavr4c73809dmg` terminó **LIVE**, con regresiones A0–A8 completas PASS. [Evidence](vnext/evidence/A9.md).\n\n**A10 probada:** [auditoría](vnext/evidence/A10.md) con campos explícitos `@audit`, diarios SQL y prueba de rollback por trigger PostgreSQL bajo Spring y Nest; fuente `9cf1032817b98088616f1838b9d7419c6c204e24`, Render `dep-db7fp2u7bikc73anp7ug` LIVE. No existe aún endpoint de consulta del historial ni UI de auditoría; el término "append-only" describe acceso mediante API, no garantías criptográficas contra superusuarios de DB.\n\n**A11 validated functional evidence:** [A11](vnext/evidence/A11.md); contracts → canonical IR/OpenAPI → Spring/Nest backend + React detail history; distinct `orders.audit` authority and real browser proof, functional source `f3bea045f033fd66d485a996dfda11bc81799acc`, Render deploy `dep-db7gataj9qps73cbub60` LIVE. Public Render service is only a marker.\n\n**A12 empirical upgrade:** [A12](vnext/evidence/A12.md), source `b441474331653930e8c0681f6ee8c1291b4547f4`, same Render deploy `dep-db7glj49v7es73c0moa0`: actual Spring/Nest A10 databases preserved during audit-page only evolution, original SQL migration ledgers unchanged, post-upgrade protected HTTP + Chromium and repeated no-op/second boot proven PASS ×2. Render build SUCCEEDED y deploy LIVE comprobado.\n\n**Unchanged historical facts:** G5 Books passed its bounded checks;
the Taller manually integrated branch has a real Render Free demo
(PostgreSQL and HTTP smoke), but is **not** a generic application
generator. P3 executor and P4 economy work are separate research
tracks and do not block vNext.

## Full-stack G0–G5 — supported pilot accepted, 2026-10-13

G0–G3 accepted within versioned bounded profiles (PRs #41–#46). G4 signed
RS256 JWT resource-server and previously isolated Schemathesis GET conformance
accepted (PR #47), now additionally tested on actual G5 PostgreSQL v0.4.
G5 historical disposable PostgreSQL/Flyway V1 pilot merged (PR #48);
its continuation, PR #49, closes the supported v0.4 fullstack pipeline with
added nullable `publishedAt`, added `renameBook`, real React browser and
JDBC/Flyway V2, role-enforced Basic and separately signed JWT profiles,
deterministic OpenAPI Generator/Orval/manifest outputs, guarded
`regenerate-fullstack`, a second independent Widgets codegen resource and
explicit historical G3 v0.3 regression.

**Exact tested source:** `941e9a8c33e0900a8867c362a774b6ff2c8f24d5`, Render deployment
`dep-db6pgquk1f9s73b1f3rg` status LIVE. **221 Python tests (1 skipped), 11 JDBC/Basic
JUnit, 8 signed-JWT/PostgreSQL JUnit, 5 real Chromium Playwright**.
The final public Render artifact is health-only, not a persistent hosted API.
See [G5 closeout](G5_CONTRACT_EVOLUTION_PROGRESS.md) for SHA, decisions and
remaining limits.

**G5 result: COMPLETE for the narrow nonproduction supported pilot.**
Production OIDC, managed database backup/recovery, P4 scientific ROI,
P5 consumer adoption and P6 stable general release remain NOT COMPLETE.
The G5 PR is tracked separately from the already-merged historical baseline.

## Merged baseline

- ProtocolIA main P2 code merge: 2df9dc77cb76ab10d70ecc1a10a4d95c28b38468 (PR #13); Java ADR merged via PR #12.
- ProtocolIA-Test main consumer P2 merge: ab705513fed5c5071737f6288b4be791456fd75f (PR #5).
- ProtocolIA source HEAD before merge: 5b4f16733acd1dc6f14b1dec51aa22cd2d48ece7; full tests on exact SHA: https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088656004 (HTTP/PostgreSQL/JUnit/Testcontainers), https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088655993 (Java Maven), https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088655983 (P0/P1 quality), https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088652081 (OpenAPI Generator Spring reference); all success.
- Independent ProtocolIA-Test commit 2c78ca2167dab7ab33dd043dca8d82272dbca963: https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38088760781 (HTTP/PostgreSQL) and https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38088760657 (regressions); both success.
- Later documentation commits need their own checks; do not treat previous runs as proof for a different exact SHA.

## Gate status

| Gate | State | Verified scope |
| --- | --- | --- |
| P0 | COMPLETE | Provider-free Python compiler, deterministic artifacts, protected regeneration and external format validation |
| P1 | COMPLETE | Normative v0.1/v0.2 contracts, executable data checks, compatibility and controlled migration |
| P2 | COMPLETE — bounded | Generated Java 21/Spring Boot 4.0.2/Maven backend, Spring HTTP and PostgreSQL sales, JUnit 5/Testcontainers and independent downstream CI |
| P3 | IN PROGRESS: P3-A/B1/B2.1/B2.2/B3/B4 VERIFIED (BOUNDED) | Signed operator gateway, real Linux Unix host-process security boundary, one isolated Docker read and provider-neutral signed micro-USD atomic budget/usage ledger. No deployed human SSO/MFA, live paid-tool accounting, writable external-effect recovery or hostile-kernel escape certification. |
| P4 | IN PROGRESS: FROZEN PILOT + LOCAL RUNNER VERIFIED | Codex/Claude subscription CLI preregistration, pinned Java/Spring external judge and one-shot local run/finalize pipeline; QA tested with fake CLIs and negative independent HTTP grading. ZERO real agent model sessions or measured savings yet. |
| P5 | NOT STARTED | Controlled real-project pilots |
| P6 | NOT STARTED | Release/no-go evidence and stability |

## What P2 actually demonstrates

- Generic generated Spring controllers explicitly return 501 for business behavior not implemented.
- An explicitly recognized inventory-sale contract generates an ACTUAL service: request validation, Spring Security with 401/403, JDBC transaction, atomic PostgreSQL stock decrement, SQL constraints, idempotency-key replay/conflict, rollback and concurrent oversell prevention.
- Generated JUnit5/Testcontainers tests exercise transaction rollback, concurrent sales and repeat-key replay on disposable PostgreSQL. Independent consumer checks equivalent HTTP behavior using its own contract, including unknown-field rejection.
- All Java model fields must use supported v0.2 constraint semantics; currently optional/null and scalar enum mapping fail closed rather than being emitted incorrectly.
- Spring security identities are environment-configured for test/dev use with bcrypt and a viewer role. No production OIDC/TLS policy or network perimeter is guaranteed.
- Flyway migrations default OFF and are only enabled by an explicit flag in CI ephemeral databases. No production DDL executed. No general approval workflow for destructive migrations is claimed.
- Output hash manifest prevents common unmanaged/manual-edit overwrite patterns but is not cryptographic attestation or race-free hostile filesystem isolation.
- Conventional OpenAPI Generator Spring Boot 4 was generated from the SAME emitted OpenAPI as a baseline scaffold. No independently matched economic superiority, model-token/USD savings or universal business-rule synthesis is claimed.

## P3-A verified implementation and remaining isolation boundary

**Merged:** ProtocolIA PR #15, main SHA 8886c31149dcb59198e6219970f56d7db4717164; ProtocolIA-Test PR #6, main SHA b4f408801c16247681b7883ef3dbc551f8fdc9f4.

**Exact tested source SHAs**
- ProtocolIA source ef5475e59989abb4845c1f1244810bd3c5fad9e6: [action-runtime CI](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38090575995), [quality CI](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38090575970), both success. [Main merge quality](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38090665861) success.
- ProtocolIA-Test consumer 7ff784ceb5ccd36c85dfdba8737b619a757f75a3: [independent P3 run](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38090603119), [existing consumer regression](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38090603150), both success. Python 3.11/3.13, separate warehouse fixture and policy.

**Proved**
- Versioned action IR 0.4 independent of HTTP-operation DAG, strict structural JSON Schema plus semantic DAG/dataflow checks, deterministic serial order.
- Only literal, sha256, assert.eq, kv.read and kv.put supported. Resource grants are injected by the host; forged capability/effects, conflicting unordered writes, shell/tools, dangerous keys and symlinks are denied.
- Writes, results and event evidence committed in the SAME SQLite transaction, cancellation, timeout and failed equality rolls back; dry-run never opens storage.
- Idempotent same-mission replay, including concurrent callers, with no double action/effect; changes to plan/policy/environment/events/resource snapshots or evidence TTL block reuse. Expired records are NOT implicitly re-executed.
- Host budgets bound number of actions, number of writes, cooperative deadlines and maximum evidence age. No provider costs/claims.

**P3-B remains open**
- Create an out-of-process, genuinely isolated adapter for external tools. Deny network/filesystem/process access except explicit grants; verify effective OS-level separation and symlink/race adversarial cases.
- Bind privileged approval to an immutable operation, identities and policy, with auditable revocation, no secret exposure or unreviewed production effects.
- Specify external retry/compensation, cancellation and timeouts with controlled partial-failure tests; support durable reservations if a paid provider/tool is involved, fail closed on unknown cost.
- Demonstrate sandboxed independent consumer tests before allowing any privilege-bearing tool. P4 economic studies are still unmeasured.

**Security limits:** SHA-256 journal digests are not signatures against a privileged journal editor. Trusted host sets policy, environment ID, clock and workspace. The SQLite local adapter is not a Linux container, seccomp isolation or permission to run arbitrary Python/shell/network. No production or paid calls were made.

## P3-B1 — independently verified Docker read-only tool

**Implemented and merged:** ProtocolIA PR #17 at main commit e9140e92db69854ba7d49c92bba55d2706ebf195; security follow-up PR #18 at main commit 5c9aa6fe5b717ab6bc7b9160d9f8aba14b9c8cb5. ProtocolIA-Test PR #7 at bb5b9a5a917e2edb08e654be4cfd0c71e8125262 and independent forged-revocation test PR #8 at 5a47c89f03b119e930d757fc663b7cd3f2ef8f94. Both repositories' source commits were verified before merges.

**Exact implementation evidence:** ProtocolIA SHA a8b31d1979980341aa4318fb1102400921b3cc8d — [actual Docker containment CI](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38091634980) and [quality](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38091634993) both SUCCESS. ProtocolIA-Test SHA 4585268d1b5078f49abb73065e98383b9556e646 — [independent real Docker CI](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38091641819) and [consumer regression](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38091641908) both SUCCESS. ProtocolIA main post-merge quality [run 38091697306](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38091697306) SUCCESS. The newest documentation commit requires a separate run; do not conflate SHAs.

**Enforced subset:**
- Trusted host chooses policy, inputs, image SHA ID, signer key and ledger; only allowlisted file.sha256 request is permitted. The model cannot choose Docker flags, host paths, process code or container image.
- Exact bounded file bytes read via dirfd/O_NOFOLLOW then staged as an isolated read-only Docker mount. Docker network none, read-only root, unprivileged UID/GID, dropped caps, no-new-privileges, memory/PID/CPU constraints, no image pulls.
- Host-issued HMAC approval sealed to plan request, policy, input bytes, declared host identity/environment, expiration and fixed tool version/script fingerprint; secret-authenticated revocation and stale input deny. No deployed human authentication broker.
- Durable single-attempt ledger and ambiguous-failure quarantine; known zero-cost operation only. Timeout stops Docker client with best-effort docker rm cleanup. No automatic paid/external retries.
- Independent consumer tested binary input, real Docker, revocation with wrong secret, concurrency, replay, expiration, traversal, symlinks, unknown-cost policy and shell/tool denial.

**Critical boundaries:** This adapter is NOT integrated into the P3-A action DAG; it is separately invoked by a trusted host API/CLI. The Docker daemon itself is privileged and must be trusted, local and isolated from models. Operator subject is host-declared, not cryptographically proven human identity. No privilege-bearing mutable operation, paid provider, general external compensation, production network exception or full sandbox-escape proof exists. The P3 issue remains OPEN for P3-B2.

See [P3-B1 threat model](P3-DOCKER-ADAPTER.md).

## P3-B2.1: typed host-approved read-only broker — verified and merged

- ProtocolIA PR #20 merge: a755d9718ded5ad34fcfc65895109b3b38decee6. ProtocolIA-Test PR #9 merge: 6acd30a0beb828948d5e5db7b8760658c6819bf2.
- Exact ProtocolIA implementation SHA 67c87ad998936215e7a6c7d10d56645908afa21a. Live typed DAG/Docker CI SUCCESS: https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38092181727 ; quality SUCCESS: https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38092181741 ; merged-main quality SUCCESS: https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38092319311.
- Exact independent consumer SHA 5557d74f0b686c7a7527a00ad8da1a5239ffac7f. Independent real Docker CI SUCCESS: https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38092249282 ; consumer regression SUCCESS: https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38092249230.
- v0.5 separate typed DAG and JSON Schemas for plan and trusted host grant policy: pure literal/SHA/equality plus EXACTLY ONE external file.sha256 read. No arbitrary tool, write, process or network permission.
- Docker request ID derives from entire normalized plan plus host policy and action identifier. HMAC host approval binds exact derived request, resource content, sandbox policy, declared subject/environment, tool fingerprint and expiry; changing plan or policy invalidates approval.
- Host-scoped grants, strict read/action/time budgets, bounded inputs and known-zero USD policy. Independent tests exercise concurrent clients, durable single-attempt/replay, revocation and forged revocation secret, stale input/policy/plan, shell and paid denials.
- The v0.4 SQLite runtime is NOT one transaction with Docker. Failed subsequent assertions cannot undo the previously completed read; repeated execution replays it. No paid or mutable external effects authorized.
- Still P3 overall OPEN: real operator authentication and signer-key custody/rotation, writable/paid effect outbox and compensation, cost reservation/settlement with unknown-cost hard block, independent hostile daemon/container escape study.

See docs/P3-B2-READONLY-BROKER.md.
## P3-B2.2: cryptographically verified operator key possession

**Merged:** ProtocolIA PR #22 at main commit d9829212e2fa20508272e068ce8104a946d01180; independent ProtocolIA-Test PR #10 at main commit 667356a48141e40c79234ec6cbd6403ffe433b63.

**Exact code SHAs and independent results:** ProtocolIA implementation SHA 2e0a71b57a0a1b28ab04dda27314852436cb9039: [full quality CI](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38093049959) SUCCESS, [Ed25519 Python 3.11/3.13 + real Docker](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38093049873) SUCCESS; latest PR rechecks at same SHA passed. Independent ProtocolIA-Test SHA f24e674e47716076c40513a365986355e299c25d: [real Docker offline-key consumer](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38093119886) SUCCESS, [consumer regressions](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38093119848) SUCCESS.

**Implemented, supported scope:**
- Optional cryptography-based Ed25519 signature verifies operator possession of a key registered by a separately trusted host, along with exact approved resource scope. The old direct subject parameter is still present in host-internal building blocks, but the *new gateway* refuses unsigned/declarative approvals.
- A domain-separated canonical signed consent binds plan hash, host and Docker policy hashes, external request ID, logical resource, image content ID, immutable tool fingerprint, input content hash, host environment, operator/key ID, protected registry digest, nonce and expiry (max 5 minutes).
- Offline CLI can create a private 0600 key on the operator's device and sign only after independently supplied plan hash and resource match. Only the public key is enrolled in host registry; the model never receives any private key or host HMAC service key.
- Trusted host gateway checks private 0600-equivalent local registry and HMAC-key files with ownership, symlink/hardlink and size checks; reserves single-use nonce durably before creating HMAC grant. Revalidates signed key grant on each execution/replay and after Docker returns, denying old grants on revocation, key rotation, stale registry or plan, expired consent and forged signer.
- ProtocolIA-Test independently generated operator keys with a subprocess signing flow, signed a separate binary receipt plan, exercised actual Docker, wrong signer, mismatch review, stale file, public-key revocation and rotation into a new approved plan.

**Not yet proven:** This verifies possession of an enrolled private key, NOT real-world human identity, OIDC/SSO, authenticator MFA, approval web interface, identity enrollment/recovery, tamper-proof hardware key, privileged host isolation against root, provider billing or external writes. The protected gateway MUST run under a restricted identity and keep lower-level unverified APIs unreachable to any model. P3 issue #4 remains OPEN.

See [operator authentication design](P3-B2-OPERATOR-AUTH.md).
## P3-B3/B4 — verified security gateway and provider-neutral budgets

- **Merge provenance:** ProtocolIA PR #24 merge SHA 781963a3291ff7e6e670660c666087508d7428a2. ProtocolIA-Test PR #11 merge SHA 75f77015b0d607424d64cc854d6dcff0214b96eb.
- **Exact ProtocolIA implementation SHA** 2be1cb4a800d492b774d67ad44cdf91e84dec468: [host-service+real-Docker CI SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38094132923), [full quality SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38094132748), [merged main quality SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38094220678).
- **Exact independent consumer SHA** 413b472369d2cb747d45a7434a2956068b5ede81: [host-service+Docker+cost CI SUCCESS](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38094179770), [consumer regression SUCCESS](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38094179809). Both used a distinct operator key, data and grants.
- P3-B3 Linux-only process separation: a dedicated socket host service with SO_PEERCRED allowlisted peer OS UIDs, private 0700 workspace, 0600 bound socket and protected host policy/registry/HMAC keys. Rejects privileged client overrides, ambiguous JSON and forged consent. Dedicated daemon and independent offline signer subprocess drive actual read-only Docker. Deployment MUST use a separate trusted OS UID from the model; a same-UID model can access host-owned files and is not isolated.
- P3-B4 provider-neutral cost controls: signed worst-case quote and actual receipt using protected HMAC key, integer micro-USD, SQLite BEGIN IMMEDIATE budget reservations, immutable scope ceiling, persist started BEFORE provider effect and never auto-release ambiguous started cost; signed settlement refunds unused reservation safely. Budget races, replay, falsified/unknown usage, over-reservation and missing trusted authority denied.
- IMPORTANT: No actual paid provider has been called and no real external spending/usage receipt was reconciled. Signed usage in CI is a test-only host fixture. The ledger API MUST be integrated with a provider-specific independent metering adapter before any billable call.

**Remaining P3 global acceptance blockers:** deployed real operator identity enrollment and MFA, separately secured approval frontend/host credentials in a real environment, safe resumable/compensatable mutable external effects and multi-effect plans, real-provider price reservation and usage billing evidence, independently assessed Docker/daemon/kernel escape resistance. Do not mark P3 complete or close issue #4.

See P3-HOST-AND-COST.md and the exact GitHub CI results above.
## P4 pilot — subscribed Codex/Claude experiment infrastructure, NO MODEL RESULTS

**Merged implementation:** ProtocolIA PR #26, merge SHA a6e4a67b36c6b9b95374b28adcfc6f822a643d43. Exact implementation candidate SHA 426d64dfeea3732f2fecb83f019ff6113b7e67d6: [dedicated P4 preregistration CI SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38095255227), [quality SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38095255145), and [merged main quality SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38095310190).

**Independent consumer:** ProtocolIA-Test PR #12 merged at commit 77ec9150fed3b1ae4e80c87befc052e34702af8c, owning four Java/Spring task specifications and black-box loopback HTTP verifier. [Verifier positive/negative CI SUCCESS](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38095065848), [merged main regression SUCCESS](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38095115354). The P4 CI fetches every consumer task from this immutable SHA and verifies its exact file SHA256.

**What actually passed:** provider-free immutable study lock, 3-arm balanced deterministic trial packets, 3 paired repeats, Codex JSONL / Claude Code JSON usage extraction without raw transcript disclosure, independent-verifier result ingestion, duplicate/revision and changed-proof denial, null-vs-zero token and money honesty, missing-trial no-winner reporting, and task/verifier independence smoke checks. One frozen protocol per CLI contains **36 scheduled trials**, and CI records **ZERO model trials**.

**Unverified, P4 still OPEN:** no authenticated Codex or Claude Code CLI was present in the runner; no agent attempts, token/quota savings, subscription marginal USD or correctness comparison A/B/C were measured. Need execute all paired trials on pre-authenticated user CLI without API keys, ensure fresh worktree/approval boundaries, preserve version/mode/repair counts, conduct independent grading and reviewer analysis; extend pilot to genuine brownfield, ambiguity and nonrepetitive tasks. A public repo's grader is not guaranteed secret from a network-enabled model. The independent verifier JSON is not cryptographically signed and cannot alone prove a clean test environment.

**Economic interpretation:** subscription CLI user pays for access/quota; API-equivalent dollar display is not real incremental subscription billing. Always report actual_subscription_usd=null unless independently metered real charges, and never claim automatic dollar savings.

Runbook: [P4-SUBSCRIPTION-CLI.md](P4-SUBSCRIPTION-CLI.md). Issue #5 remains OPEN.
## P4 local runner — one-shot agent invocation plus real independent FAIL testing

**Merged:** ProtocolIA PR #28 at main commit 8905c0428e3d71dee1d47616fdc9226f711d5fa4; ProtocolIA-Test PR #13 at main commit 87e482961f29eb7c8a6c5c9bc60de2ad08a903cc.

**Exact tested source:** ProtocolIA SHA 80a0129b4535a508b0ead969e53467c67ff72270, [Python 3.11/3.13 fake Codex/Claude local runner CI SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38096727645), [quality SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38096727642); ProtocolIA-Test SHA db6415eb514e4f7f7b4fb134a89c12275c650384, [independent consumer fake successful-CLI → actual FAIL HTTP judge CI SUCCESS](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38096855866), [consumer regression SUCCESS](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38096855783). Each run is tied to immutable source SHA, not previous build status.

**Implemented:** locally prepare a trial from SHA-locked independent task fixture in a fresh Git worktree; keep prompt and CLI traces in separate host-private evidence directory. CLI run requires explicit --execute quota consent, a named model, reject known API-key billing variables, normal Codex/Claude permission mode, deadline and process-group kill; claim attempt before invocation, never silently re-run. Independent finalize requires an unchanged pinned grader checkout and scores even failed HTTP backends, records null subscription USD and tokens if unobservable, and publishes one result per run ID.

**Independently verified negative control:** a simulated Codex process exited 0 with token counters but produced NO server. The actual ProtocolIA-Test black-box HTTP verifier hit a closed loopback port and failed, so the report preserved 0 successes, 35 missing runs, UNKNOWN incremental USD and NO winner. This is an intentionally failed control, not evidence of actual Codex/Claude generation performance.

**Unverified:** neither tool is installed/authenticated here; real 36-attempt A/B/C trials were not launched. No actual token savings, quality improvement or incremental subscription costs have been measured. Local workspace/evidence separation is not a kernel sandbox or true secrecy from the same OS UID. Verifier JSON is not cryptographically signed or guaranteed tied to a running candidate code digest; execute untrusted code only in an external disposable VM/container, and require independent reviewer provenance for published research.

Workflow: [P4 local runner](P4-LOCAL-RUNNER.md), [frozen study](P4-SUBSCRIPTION-CLI.md). P4 issue #5 stays OPEN.
## Next

P3 remaining: local OS-separated approval and provider-neutral cost ledger are verified, but actual enrolled human MFA/approval UI, a paid-provider metering connector, recoverable writable/multi-effect outbox and hostile sandbox evaluation are still required. Do not confuse test signed quotes with actual provider bill settlement. P4: frozen A/B/C studies and local subscribed CLI invocation+independent grading are ready; next run real Codex/Claude Code trial sets with a separately authenticated local CLI, no API keys and faithful agent/verifier isolation, then measure quality/time/tokens. Full P4 is OPEN.

See ROADMAP.md, ADR-002-JAVA-BACKEND.md and P2-BASELINE.md. This file is the execution record, not a promise of work completed beyond these gates.

## Empirical execution preflight — 2026-10-11

36 scheduled, 3 catalog-crud workspaces prepared, **0 real sessions and 0 independent candidate verdicts**. Codex 0.159.2 reports ChatGPT login. Global approval flag placement corrected after real parser rejection. Restricted disposable agent/JVM execution remains unverified in this environment; Java 21/Maven/treatment tools also need provisioning. No empirical improvement claim. See [audit and reproduction procedure](P4-EMPIRICAL-AUDIT-20261011.md) and [machine-readable evidence](../benchmarks/p4/evidence/20261011-preflight/preflight.json). P4 remains OPEN.

## P4 nested CLI reattempt — 2026-10-11

`main` 2a7e1e0 was used to prepare and invoke frozen `codex-catalog-crud-r01-conventional` through `/opt/codex/bin/codex` 0.159.2 after its parser preflight passed. The nested CLI stopped in 7.587 seconds because this Work sandbox made its own `/root/.codex` state database read-only; it emitted no model event and created no candidate source. This is `INVALID_ENVIRONMENT_BEFORE_MODEL_TURN`, with zero evaluator verdicts and zero comparable A/B/C results. It is retained as provenance, excluded from arm outcomes and not retried automatically. See [nested execution record](P4-NESTED-CLI-EXECUTION-20261011.md).

## P4 B artifact on Render — functional PASS with build defects (2026-10-11)

Published manual top-level Work B source at `13596c5e499b918a36c8becc549d3b8b5ddb9b8b` (Git tree `85a1ea836de328fa7785ed81506f11713058717d`) was assessed on separate free Render infrastructure. Original `mvn clean verify` **FAILS test compilation**; normal packaged JAR **fails to start**. Without source changes, evaluator skipped test compilation and started the compiled classes using its own runtime classpath; the **frozen independent ProtocolIA-Test `77ec9150f` HTTP verifier PASSed** (`evidence_sha256=e15f7f91a5d6db6c2a5abdd3d27afd09fd0b886006672cdcf4c0ae39d0cd10cd`). This is exploratory **out-of-study** evidence: model/config/tokens/time UNKNOWN, top-level Work not subscribed Codex CLI, 0 valid matched Codex sessions. See [P4 Render B evaluation](P4-RENDER-B-EVALUATION-20261011.md) and [evidence JSON](../benchmarks/p4/evidence/20261011-render-b-exploratory/evaluation.json). **Issue #5 OPEN; no A/B/C winner, no savings claim.**

## P4 C artifact on Render — HTTP functional PASS; generated backend not used (2026-10-11)

Published C manual top-level Work source `2cc3d6938c64b65f281ee10396f460d6dea13781` (Git workspace tree `b08a7206ee3357eef9198f949c9c47b7d45a9489`) was evaluated with the same free Render Java 21/Maven toolchain as B. The generator's 10 files are preserved in `workspace/protocolia-generated` but **not wired into the runnable module**; generated business endpoints return 501, and 7/8 manually authored core Java files match B by Git SHA. Original `mvn clean verify` **FAILS** test compilation on missing Boot 4 `AutoConfigureMockMvc`; packaging with `-Dmaven.test.skip=true` produces executable JAR, running backend LIVE. **Unchanged pinned ProtocolIA-Test `77ec9150f` verifier HTTP PASS** (`tests_passed=true`; `security_passed=true`), though the digest equals B because it hashes only common PASS-result fields. This is an **out-of-study exploratory** candidate; model/config/time/tokens UNKNOWN, 0 valid matched Codex CLI runs. See [C Render evaluation](P4-RENDER-C-EVALUATION-20261011.md) and [C evidence JSON](../benchmarks/p4/evidence/20261011-render-c-exploratory/evaluation.json). **No superiority/cost claim; issue #5 OPEN.**

## P4 A artifact on Render — exploratory triple completed (2026-10-11)

A direct `catalog-crud` source publication `46c09bbc06e29775a14ad849e43861d7f459f3a3` (Git tree `2c30c61963753ea022bcd4d73bfc9250b8606843`) was compiled in the same Render Java21/Maven environment as B/C: **`mvn clean verify` FAILS test compilation** on missing Spring Boot 4 `TestRestTemplate`; skipping tests yields **executable JAR PASS** and **LIVE** Java API. Unchanged frozen verifier `ProtocolIA-Test@77ec9150f` produced an independent HTTP **PASS**, with verdict hash `e15f7f91a5d6db6c2a5abdd3d27afd09fd0b886006672cdcf4c0ae39d0cd10cd`. Exploratory A/B/C matrix: all 3 HTTP PASS; all 3 native test compilation FAIL; B's original JAR fails standard launch while A and C's work with tests skipped. All top-level Work provenance unmatched (model/effort/tokens/time null), so still **0 eligible Codex CLI sessions**. C generated skeleton not wired into running code; 7/8 core files identical to B. **No ProtocolIA winner or savings evidence; issue #5 remains OPEN.** See [A report](P4-RENDER-A-EVALUATION-20261011.md) and [evidence](../benchmarks/p4/evidence/20261011-render-a-exploratory/evaluation.json).

## Product-first track — real generated Java application works (2026-10-11)

P4 research is **paused** rather than closed. New product work is on `feature/product-first-java-handlers`: generic `java-spring/0.4` now generates an injected `ContractHandlers` interface used by the sole generated MVC controller. A handwritten, separate service implements typed business rules. In Render `dep-db5v28ad0e5s738q8hh0` the contract validates, 11 Java artifacts generate, **7 Python unit tests PASS**, `mvn clean verify` **BUILD SUCCESS** with **1 JUnit HTTP integration test PASS (0 failures)**, normal executable JAR SHA-256 `71a824c40394ee58fb329d891e820c14aaef904a994d662bc896d7cb78957da5`, deployment **LIVE**, and independently queried public `/health` returned `{"status":"UP"}`. No shadow/manual controller. Basic auth is a local demo, not production identity; books in memory. See [product-first plan](PRODUCT_FIRST_PLAN.md). Frozen P4 trial/evidence and issue #5 remain untouched/open.

## Java generic target Step 2 — manifest evolution and read-only viewer (2026-10-11)

Product hardening on `feature/java-v04-regeneration-auth-hardening`, independent
of frozen P4: generated file-set evolution safely adds/removes owned model
artifacts, preserves custom handlers and refuses modified/unmanaged/symlink
outputs; optional test viewer obtains only declared non-writing GET authorities.
Render free `srv-db5v9ovlk1mc73bc45fg` verified **12 Java-generator Python
tests**, **4 inventory-template regression tests** and **1 real Spring Boot
HTTP integration test including read-only 200 / write-denial 403**, all PASS.
`mvn -B -ntp clean verify` BUILD SUCCESS, no test skipping; executable JAR
SHA-256 `ec2c9032bb1617f3298228f62458eb23b9519cbfc6b208e0e2ea9177ba2ebca5`.
See [product-first plan](PRODUCT_FIRST_PLAN.md). P4 issue #5 unaffected.

## Product-first Java developer workflow — stage 3 completed (2026-10-11/12 UTC)

The CLI gained `protocolia init-java CONTRACT --out DIRECTORY`. One operation
generates the complete owned Java 21/Spring Boot 4 contract artifacts and
bootstraps exactly one *user-owned* `StarterHandlers.java` implementation of
`ContractHandlers` (all methods return an explicit HTTP 501 until edited).
Rerunning initialization safely regenerates owned files and preserves the
custom class byte-for-byte. After a contract API signature change the user
updates the custom code intentionally; no silent replacement or shadow MVC.
No secrets or provider APIs are inserted into starter source.

In free Render deployment `dep-db64002jnfac73cb38og`, the pipeline passed
**7 new Python CLI workflow tests**, **12 Java-generator Python tests**,
**4 inventory Python regressions**, and two independent Java 21/Maven 3.9.11
`clean verify` builds with real JUnit HTTP tests: fresh generic app verified
unauthenticated 401 and authenticated unimplemented 501; fully implemented
catalog handler verified real CRUD, validation and viewer 403. No skipped
tests. Final deployed catalog JAR SHA256:
`210b8458bd3cc55c1777fdde5a3b2c62734b1c8f2f783d6ab648a3aa8869e588`.
Render service `srv-db63vvijnfac73cb36jg` **LIVE**, external `/health`
responded `{"status":"UP"}`. See [single product plan](PRODUCT_FIRST_PLAN.md).

Stage 3 is complete for this supported Java target. Next work is a *small*
real change-workflow comparison against direct Java and standard generation,
not a restart of P4. Research issue #5 remains open.

## Product value check — stock PATCH, comparable HTTP behavior (2026-10-11/12 UTC)

Stage 4 is a **non-P4 exploratory product** change. Added
`PATCH /api/books/{isbn}/stock` to generated Java catalog and an isolated
editable direct A copy; original study branches are untouched. Both passed
`mvn clean verify` (3/3 real HTTP JUnit tests, including read/write auth,
atomic concurrency, invalid input, 404 and 409); 23/23 Python generator tests
also passed. The direct copy needed a targeted repair because initial 409
overflow surfaced as 403 (Spring security error dispatch); first Render build
`dep-db64dhjbc2fs73aovuvg` FAIL, second `dep-db64e8dckfvc73c3h0t0`
PASS for both. Marginal scope: generated **2 manual artifacts, +20 Java
lines plus JSON contract changes**; direct **3 feature Java artifacts, +30
Java lines**, excluding baseline parity security/test work. **No duration,
model-cost or ROI conclusion**. Full [result](../examples/stock-change/RESULTS.md).

## G0 contract-to-software: Java Basic HTTP projection — VERIFIED SUBSET (2026-10-12)

New strictly opt-in `protocolia compile-http --profile java-spring-basic-demo`
produces an HTTP OpenAPI 3.1 contract faithful to the current generated Java
demonstration's Basic authentication and POST 201 / GET-PATCH 200 success
codes. Domain 404/409 cases require explicit declarations; no unverified
error body formats asserted. The historical v0.1/v0.2 default compiler and
manifest outputs remain unchanged. **This does not complete G0.**

Tested branch SHA `2ea2ecb6b8ac52833e599b06a0a11f27e591512b`,
Render Free service `srv-db66d3qd0e5s739ige00`, deploy
`dep-db66d42d0e5s739igfi0` **LIVE**. 26/26 Python Java-target tests
(including 7 new projection tests), 4/4 inventory tests, Java 21 Maven
`clean verify` **PASS** for both generated and handwritten apps, **3/3
real HTTP JUnit tests each**. Public GET /health independently returned
`{"status":"UP"}`. The earlier startup health request returned 503 until
Spring finished booting. Java target here uses Boot 4.0.2, not the research
candidate 4.1.1. [Detailed G0 state](G0_HTTP_PARITY_PROGRESS.md).

Still outstanding: typed resource/view IR, manifests, OpenAPI3.1 corpus,
Spectral/oasdiff, error schemas/headers, G1 OpenAPI Generator comparison;
no paid providers or frozen P4 changes.

## G0 semantic resource bundle + independent contract gates — VERIFIED SUBSET (2026-10-12)

PR #42 on branch `feature/g0-semantic-resource-bundle` expands the
Java-target HTTP projection into validated, versioned resource/view semantics.
New `compile-bundle` and `diff-bundle` commands emit four derived artifacts:
`resource-ir.json`, `ui-manifest.json`, `capability-manifest.json`,
`generation-manifest.json`, alongside existing four compilation artifacts and
ownership manifest. These sidecar bindings only link **existing** operations;
they cannot authorize a caller, create a list endpoint, or infer persistence.

**Verified source SHA `8bcaca892d7098811e9daed49e102b4c04e7b8ac`**, Render Free deploy
`dep-db69e7t9fdbs73fask70` for service `srv-db695b8473hc73dk978g`
**LIVE**. **Python 38/38** (26 Java/profile, 8 semantic, 4 inventory);
**Spectral 6.17.0 PASS**, **oasdiff 1.11.7 PASS** (intentionally removed
endpoint detected as ERR and denied with `-o ERR`); Java21/Boot4.0.2 Maven
**BUILD SUCCESS** on both generated and direct programs, **3/3 real HTTP
JUnit tests each**. Public GET /health returned `{"status":"UP"}`.

Historical v0.1/v0.2 default compiled artifacts remain unchanged; the
Java target/basic demo contract is separately projected. G0 continues:
unsupported query-pagination and broader 3.1 semantics, unverified error
headers/bodies, G1 external server generator/Boot 4.1.1 and downstream
TS/RJSF/OAuth2 remain OPEN. See [G0 resource evidence](G0_RESOURCE_BUNDLE_PROGRESS.md).

## G0 v0.3 bounded query and paginated Books — verified subset (2026-10-12)

PR #43 adds new opt-in contract v0.3 and bounded GET integer query arguments
with defaults and explicit min/max, plus real `listBooks` HTTP operation,
`BookPage` response and resource sidecar v0.2. Source and old v0.1/v0.2
compiler outputs are preserved. Exact experiment and result in
[G0 v0.3 pagination evidence](G0_V03_PAGINATION_PROGRESS.md).

Real Java 21 / Spring Boot 4.0.2 HTTP tests **5/5 PASS** and Maven `BUILD
SUCCESS` at source SHA `74316193b31c3508635e6667672d5b462e09d36b`.
Final feature SHA `4f2aab816bb8082c514bc681c9733e6435d34e8c`
added a Python test and README only; Render Free deploy
`dep-db6h28d9fdbs73fh8780`, service `srv-db6gu7ff3r2c73c7v990`,
**LIVE**, ran **47/47 Python tests PASS** at that SHA and used Docker
cache for unchanged Maven/Spectral/oasdiff layers. Public `GET /health`
returned `{"status":"UP"}`. Prior un-cached Spectral 6.17.0 and oasdiff
1.11.7 passed, including a deliberate removed-endpoint breaking fixture.

First attempt failed two JUnit cases (Spring 500 vs expected 400, plus
faulty test extractor), both repaired and explicitly reported.
G0 remains OPEN for broader OpenAPI 3.1/error/query-runtime corpus;
G1 replacement spike still pending. No P4 changes or paid APIs.

## G1 verified upstream Spring generator parity — NOT PROMOTED (2026-10-12)

G1 experiment [`experiments/openapi-generator-spring`](../experiments/openapi-generator-spring/README.md) compiles the **same v0.3 Books target OpenAPI** using pinned OpenAPI Generator **7.26.0** with Spring Boot **4.1.1** / Java 21, generated Java API/controllers/delegates/models/ApiUtil only, with user-owned root POM/domain/security. Two separate runs of codegen yielded **zero generated-source differences**, five operation-to-capability bindings passed a fail-closed check. The handwritten business delegates implement every required operation (not 501-only).

**Exact tested source `1b3478059e36be79de8d9834b196a21ec0d9f88e`**, Render Free deploy `dep-db6hv5d9fdbs73aplqgg` on service `srv-db6hmh3rjlhs73eqq2bg` **LIVE**, Maven `clean verify` **BUILD SUCCESS 7/7** (5 actual HTTP/JUnit, 1 delegate completeness, 1 internal error-dispatch security), public `GET /health` independently returned `{"status":"UP"}`. JAR SHA-256 `3e3bf815fb3055b03e147f1a1a418d4206bb15309e5cf6fdd9ae929fa6e3d365`. All earlier failures were recorded and fixed: missing ApiUtil, Spring's internal ERROR dispatch causing erroneous 403 rather than 400/409. No paid model APIs or GitHub Actions minutes.

**Architectural decision: hold promotion.** Upstream generator passes the bounded runtime/parity experiment, but has 174 nonblank user-maintained Java app lines vs 78 of the prior Books handwritten handler (different scopes, not a fair productivity study). Retain existing ProtocolIA Java backend and the upstream optional experiment pending broader OpenAPI 3.1/security/capability corpus. [Complete G1 evidence](G1_OPENAPI_GENERATOR_EVIDENCE.md).

## G2 Orval TypeScript client / TanStack Query — VERIFIED BOUNDED PILOT (2026-10-12)

Orval **8.41.0** selected as the **single** supported TypeScript client generator in `examples/books-web` using pinned npm lock + `npm ci`. Kubb CLI 5.8.0 and plugins ts 5.0.6/fetch 5.5.7/react-query 5.2.1 compiled and typechecked against the same G0 target HTTP OpenAPI, but no Kubb real HTTP parity is asserted; the original plan's `plugin-react-query@5.5.5` does not exist on npm. React Query cache invalidation is explicit, reviewed, and cross-checked against ProtocolIA manifests; backend remains server authority.

**Verified build source `58703e141d5f8d3f3c1749d761883447ee52c25f`**, Render Free deploy `dep-db6jemdg1s2s739ihh1g` / service `srv-db6j4o8473hc73dihj00`; candidate and selected TypeScript builds, manifest and regeneration gates PASS, and **real Java backend HTTP integration PASS** for list/get/create/adjust, 201/400/401/403/404/409, cached list-page/detail invalidation and eight concurrent restocks exactly 24. Runtime publication is tracked separately; local integration never mutated public service. Full [G2 source and test evidence](G2_TYPESCRIPT_CLIENT_EVIDENCE.md). GitHub Actions/P4 untouched, no paid API. Browser UI and advanced form generation stay G3.

## G3 verified Books schema-driven UI + Chromium browser E2E — PILOT DONE (2026-10-12)

[Verified G3 evidence](G3_BOOKS_UI_EVIDENCE.md) establishes a **React 19 /
Vite 7.1.9 / RJSF 6.7.1** frontend on the existing G2 Orval SDK.
`ui-manifest.json` provides field lists/order, view roles and actions;
`payload.schema.json` draft 2020-12 via Ajv2020 provides Create and
Restock form validation. UI shell/layout is handwritten. Spring remains
sole authority on capabilities; reader/writer selection only changes the
display, never server privileges. G2 generated API remains disposable.

**Exact tested source SHA `eeff8a628ca9a3487ef6a9b50b9797425c4a4f96`**; Render Free service
`srv-db6l6stg1s2s739pr5m0` deploy `dep-db6lbbd9fdbs73fqr6h0`
**LIVE**. Real TypeScript/Vite and Orval regen checks PASS, and a built
Vite preview using explicit Render allowedHost passed unknown-host denial
and same-origin health proxy. **Playwright Chromium 3/3 PASS** against a
local real Spring Boot 4.1.1 server: create/list/get/restock, 2020-12
invalid numeric/blank validation, cache freshness, pagination, 401/403,
and a mobile 390 px layout. Independently verified external React page
and `/health -> {"status":"UP"}` *after* Free JVM cold start. First
runtime failures (non-root Vite temp EACCES, Render host HTTP 403) were
fixed and preserved as negative evidence. `npm ci` with committed lock.

**Next G4, not automatic production deployment:** JWT/OIDC trusted
capability mapping and broader Schemathesis tests; PostgreSQL/persistence
and wider JSON Schema grammar remain open. Frozen P4 untouched; no paid
model APIs or GitHub Actions minutes used.


## G4 — trusted JWT capabilities + Schemathesis bounded pilot (2026-10-12)

PR #47 introduces isolated `experiments/g4-jwt-capabilities` with a
**separate truthful Bearer JWT OpenAPI profile** derived from G0's immutable
Books Basic profile, deterministic SHA provenance, five-operation
manifest-to-policy guard, Java 21 / Spring Boot 4.1.1 OAuth2 Resource Server,
RS256 HTTPS JWKS validation of iss/aud/exp/nbf, fail-closed scopes -> internal
capabilities, plus HTTP and `@PreAuthorize` method-level enforcement.

**Last tested code SHA `22235015dcef0fce95c974a824f9cc6887a6d0dd`:**
Maven **BUILD SUCCESS 7/7 JUnit** for real signed JWT HTTP responses and
direct proxied method authorization. Pinned Schemathesis 4.30.1 generated
**2,263 cases, 3 GET operations PASS** on the exact code
SHA `22235015dcef0fce95c974a824f9cc6887a6d0dd`, with the full JWT HTTP/method test suite rerun at the same SHA. No public POST/PATCH fuzzing or production IdP.
Render service `srv-db6lq3s9v7es73815pd0` runs **only a public verification
health marker**, not the JWT Books API. P4 unchanged; no Actions minutes.

The full evidence is [G4 JWT + Schemathesis](G4_JWT_SCHEMATHESIS_EVIDENCE.md).
**G4 production rollout is NOT finished**: real OIDC provider validation,
trust-store/key rotation, operational security, broader API fuzz and G5
persistent storage remain open. Preserve G1–G3 Basic demo separately.

## G5 — PostgreSQL/Flyway persistent Books verified slice, broader G5 OPEN (2026-10-12)

[Evidence](G5_POSTGRESQL_PERSISTENCE_EVIDENCE.md), branch `feature/g5-postgresql-persistence-pilot`. Opt-in Docker build of ProtocolIA v0.3 target OpenAPI -> generated Java21/Boot4.1.1 APIs -> **user-owned Spring JDBC BookInventory**, reviewed Flyway V1, isolated PostgreSQL **16.10**. Full DB code test SHA `a366ac3a9b133b5306ed01df75d9d778f5807b04` achieved **10/10 JUnit / Maven BUILD SUCCESS**, including negative DB constraints, rollback, 409 duplicate/overflow, existing real HTTP pagination/Auth/concurrent stock. Two distinct JVM invocations on the same scratch PostgreSQL database yielded `G5_PERSISTENCE_SURVIVES_TWO_JVM_PROCESSES_PASS` and 9 persisted rows. Source SHA `07dbff4e19b80394921282e284079d2569cb3ab3` additionally passed deterministic independent Java regeneration, exact Render deploy `dep-db6n1eou01pc73fem450` **LIVE**; unchanged downstream DB test layer could be cached. Public service `srv-db6mvhks728c73cktj8g` exposes only a safe health marker (`persistent_books_api_publicly_enabled=false`). Initial Spring transactional final-class CGLIB failure corrected and recorded. G5 still OPEN for typed optional evolution/full-pipeline regen, a second resource, managed DB, production OIDC and recovery. P4 unchanged; no paid models/Actions minutes.

### G5 acceptance refresh — clean fresh DB suite on latest runnable code (2026-10-12)

Real G5 test source SHA `4273715d6127a965c63dfa04109eb67d475a543a`, Render Free deploy `dep-db6n3vcs728c73clei60` **LIVE**: generated Java diff zero; PostgreSQL 16.10 + Flyway migration; Maven `BUILD SUCCESS`, **10/10 JUnit**; negative PATCH quantity 0 returned 400 and did not alter stock; the next Java process read the persisted book at stock 9. Source change to restart test forced the database test layer to run rather than reusing its previous cached result. `G5_DURABLE_ROW_COUNT=9`. [Full evidence](G5_POSTGRESQL_PERSISTENCE_EVIDENCE.md). Published Render service remains health-only; G5 broader schema-evolution and managed persistence gates still OPEN.

### vNext A13 closure and A14.1 scoped implementation (2026-10-14)

A13 immutable contract blob `298d95e7ab6c1b1588454921ab71d52ee2d599fd`, score `13/16 PASS`. Original Render marker deploy `dep-db7h1pjbc2fs73f6mshg` confirmed LIVE. Main unchanged, PR #52 open; feature secondary synchronized by safe fast-forward.

A14 adds a generic `reassignReference` TypeSpec/IR primitive with isolated assignment authority, compare-and-swap FK update, transactionally audited before/after history and generated React relationship picker. Render build for `4912859d22694469e1639a754112649dec38f7e7` **succeeded** with **48/48 Node PASS**; actual Spring and NestJS PostgreSQL HTTP fault-injected audit rollback, 10-way race, authorization, Chromium 390×844 and restart probes each **PASS**. Deployment did not reach LIVE: it was canceled in the update phase. No generated app is publicly served with durable PostgreSQL.

Subsequent code adds fail-closed A13→A14 operation evolution without DDL and separate seeded PostgreSQL upgrade checks; this extra code and its newer Node test are **NOT RUN / BLOCKED**. Render service events for deploys `dep-db7hu6k9v7es73c4u5ng` and `dep-db7hv1i5b2lc7381ar90` explicitly show `pipeline_minutes_exhausted`; further free builds cannot run until quota becomes usable. No Actions or paid services used. C15 search and C16 notifications remain UNSUPPORTED, with externally reusable implementations assessed in `docs/vnext/evidence/A14.md`.

### vNext A14.2 implementation checkpoint (2026-10-14)

Added queryFilter/queryOrder TypeSpec decorators and queryPage IR behavior, shared strictly allowlisted PostgreSQL query plan, Spring/Nest implementations with bounded and parameterized predicates, one-hop FK join, ascending/descending contract-controlled stable ordering, additive indexes, React typed search controls and A5 additive query operation evolution. New independent facility-maintenance-a142 contract and positive/negative/HTTP/PostgreSQL/Chromium/evolution probes committed; Dockerfile includes new probes. Current generator JS functions were exercised against an independent synthetic 3-entity IR using a simulated filesystem and yielded equivalent Spring/Nest query manifests and three SQL indexes. This is **isolated generation evidence**, not a compiled backend or database test.

Full TypeSpec/Node/JVM/Nest/PG/browser runtime verification of A14.2 remains NOT RUN/BLOCKED because Render still reports pipeline_minutes_exhausted. See docs/vnext/evidence/A14_2.md. A13 immutable score and A14.1 empirical C14 PASS unchanged. Main untouched and no Actions minutes.

### vNext A14 Codespaces execution harness (2026-10-14)

Independent optional `Dockerfile.codespaces-a14` + `.devcontainer/devcontainer.json` and one-command `scripts/vnext/run-codespaces-a14.sh` have been committed to the PR branch. They use Codespaces' separate included personal-account quota with a 2-core dev container reusing Docker on the Codespaces VM. No GitHub Actions, prebuilds or Render are invoked. The Docker test build compiles official TypeSpec and both backends, then runs isolated PostgreSQL/Chromium A14.1+A14.2 probes including seeded A13-to-A14 evolutions. Build output and exact-commit PASS/FAIL JSON go to local `.protocolia-evidence/codespaces/`, excluded from Git. Prior legacy Render Dockerfile's incorrect A13-creation ordering relative to A14.2 evolution was corrected.

**Status: PREPARED / NOT RUN.** No Codespaces create/SSH/execution action is available through the current GitHub connector, so a Codespace has not yet been created or executed by the assistant. The repo owner can launch the Codespace on the branch with the documented link and issue the single test command. Do not claim a PASS until results are available. `main` remains unmodified.
