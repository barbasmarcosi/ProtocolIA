# ProtocolIA v1.1o — External PostgreSQL role split and post-health write handoff

Date: 2026-10-22. Draft PR: https://github.com/barbasmarcosi/ProtocolIA/pull/55

**CI at initial publication:** Spring + NestJS matrix https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39792986722 — PENDING. Do not claim integration acceptance until both jobs complete successfully and the role separation marker is observed.

## Objective and bounded result

v1.1n can block every new connection to the disposable `protocolia` database while the PostgreSQL gate is engaged. Before the newly generated app starts, that connection gate must be released. Previously, a separately provisioned external SQL writer could potentially connect during the release-to-health interval.

v1.1o introduces a **role-specific policy for external clients in the disposable Compose fixture**, while keeping the v1.1n server-wide connection gate and the v1.1m signed one-time approval. It does not silently change the generated NestJS/Spring app's privileged migration account.

### External reader and writer identities

The module `packages/cli/disposable-role-policy.mjs` implements the CLI commands:

- `app:deploy:roles:prepare`: only after the old app is stopped, with the exact v1.1m signed permit and disposable Compose identities, provisions distinct non-superuser `protocolia_ci_reader` and `protocolia_ci_writer` roles. Both have NOLOGIN and random credentials recorded in a new owner-only JSON outside the generated app. Revokes database CONNECT from PUBLIC, grants explicit CONNECT to those roles and grants SELECT-only privileges to the reader. The writer gets SELECT/INSERT/UPDATE/DELETE on existing public business tables and usage on sequences; migration history and audit tables are excluded from table grants.
- `app:deploy:roles:blocked`: **after the server-wide DB gate has been released**, proves both external roles remain NOLOGIN, the old service is still stopped and a direct attempt to log in as the writer is refused by PostgreSQL. Therefore untrusted external clients using these particular roles cannot reconnect before the new app passes the acceptance check.
- `app:deploy:roles:activate`: after the actual pinned-image app restarts, reruns the existing post-start image-ID + loopback-health verification against the original test DB/container, checks that the external roles remain blocked and their privilege split is intact, and only then enables LOGIN. Confirms the reader can SELECT and is denied a zero-row UPDATE on a contract-derived business table.

The access policy discovers domain tables from PostgreSQL metadata and excludes the audit and migration journals, rather than assuming an application-specific entity or column. No public business rows are modified by the privilege check.

### Integration order

1. Verify the independently signed Ed25519 permit and successful old-image recovery drill.
2. Stop the original **disposable** app. Verify no SQL client sessions and checkpoint freshness.
3. Provision independent external reader/writer roles, both NOLOGIN, with narrowly scoped privileges.
4. Engage the v1.1n PostgreSQL `datallowconn=false` gate, verify no connections (including configured superuser), release with the consumed nonce, and reject replays.
5. **While the database accepts connections again**, prove the external writer remains NOLOGIN and the old application stays stopped.
6. Start the exact staged image with no pull/build, prove migration, original row preservation, new business writes, post-start image equality and HTTP health.
7. **Only after successful post-start verification** activate the external role logins and prove reader SELECT / UPDATE denial.

All project names remain hard-fenced to random `pia_ckpt_<10hex>` fixtures. The external roles and their credentials exist only in disposable CI PostgreSQL containers. Do not reuse test credentials or this role lifecycle on other systems.

## Technical and security limits

- This is a meaningful **external-client privilege split**, not full least-privilege application credentials. The existing generated backend still authenticates with `protocolia`, the privileged DB bootstrap/migration account, and can modify data after the v1.1n gate opens. **Production remains unsupported.** A future step must give application runtime and migration separate, narrowly privileged credentials, including application startup migrations and Hibernate/Flyway/Nest behavior.
- NOLOGIN rejects **new** authentications for those roles; it does not terminate an already open session by itself. The v1.1n database-wide gate terminates sessions before this release-to-health phase. PostgreSQL administrators or other pre-existing superuser accounts are outside the external-role guarantee.
- The reader/writer SQL test uses container-local PostgreSQL connections, which may be configured for local socket trust. It checks the role-login and table permission semantics, **not remote TCP password-authentication policy**. External exposure, secret delivery, and HBA security remain deployment concerns.
- Domain table permissions are enumerated from existing tables. They do not automatically grant access to new tables, and do not constitute a TypeSpec authorization model for users.
- These scripts are restricted to disposable CI projects. They do not guarantee atomic application cutover, independent signed production authority, remote OCI image authenticity, complete failure recovery or production DB rollback.

**Next engineering priority:** introduce distinct migration and runtime SQL accounts into the generated backends and prove real, minimally privileged startup/migration parity in Spring/Nest, before allowing external deployment targets.
