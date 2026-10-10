# ProtocolIA — Execution State

Updated: 2026-10-10. P0, P1, bounded P2 and P3-A local action execution and P3-B1 bounded Docker read-only adapter are MERGED and independently verified. P3 as a whole remains open.

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
| P3 | IN PROGRESS: P3-A + P3-B1 VERIFIED | Local v0.4 typed action DAG and atomic replay; separate host-approved Docker read-only tool with real kernel/container restrictions, no network, immutable inputs and zero-dollar policy. No privileged general executor or paid accounting. |
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

## Next

P3-B2: connect the restricted adapter to the action DAG through an authenticated host broker; implement audited writable/paid tool boundaries, cost reservations, compensations and independent adversarial tests. P3-B1 already proves only read-only Docker isolation. P4: preregister held-out tasks comparing direct agent, normal generator, ProtocolIA; count all-in cost per independently verified success and correctness/security.

See ROADMAP.md, ADR-002-JAVA-BACKEND.md and P2-BASELINE.md. This file is the execution record, not a promise of work completed beyond these gates.
