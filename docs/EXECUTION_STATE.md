# ProtocolIA — Execution State

Updated: 2026-10-10. P0, P1, bounded P2 and P3-A local action execution and P3-B1 bounded Docker read-only adapter and P3-B2.1 typed read-only broker and P3-B2.2 Ed25519 signer gateway are MERGED and independently verified. P3 as a whole remains open.

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
| P3 | IN PROGRESS: P3-A + B1 + B2.1 + B2.2 VERIFIED | Typed v0.5 read-only Docker broker now requires cryptographic Ed25519 operator key possession in a new gateway; signed scoped intents, operator revocation/rotation and protected host signing keys verified. No deployed human enrollment/MFA, paid/writable external effects or cost settlement. |
| P4 | NOT STARTED | Independently evaluated matched A/B/C coding-agent cost-per-verified-success |
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
## Next

P3-B2 continuation: Ed25519 operator key-possession and host key custody are verified; next deploy independently authenticated human enrollment/approval service, then implement durable outbox/recovery and fail-closed cost reservations for writable/paid tools. P4: preregister held-out tasks comparing direct agent, normal generator, ProtocolIA; count all-in cost per independently verified success and correctness/security.

See ROADMAP.md, ADR-002-JAVA-BACKEND.md and P2-BASELINE.md. This file is the execution record, not a promise of work completed beyond these gates.
