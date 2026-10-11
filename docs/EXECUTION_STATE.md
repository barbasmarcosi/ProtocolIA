# ProtocolIA — Execution State

Updated: 2026-10-10. P0, P1, bounded P2 and P3-A local action execution and P3-B1 bounded Docker read-only adapter and P3-B2.1 typed read-only broker and P3-B2.2 Ed25519 signer gateway, P3-B3 local host approval service and P3-B4 signed cost ledger are MERGED and independently verified within their bounded scopes. P3 as a whole remains open.

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
