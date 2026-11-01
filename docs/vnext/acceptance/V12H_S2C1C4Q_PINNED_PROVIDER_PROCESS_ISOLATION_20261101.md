# S2c-1c4q — Pinned one-shot migrator and HMAC ingress process isolation

**Status: implementation proposed; runtime CI must be checked before claiming acceptance.** This is a disposable, opt-in sandbox boundary, not a production provider or settlement integration.

## Threat, scope and invariant

The S2c-1c4p generated Spring/Nest HTTP handler uses a dedicated PostgreSQL ingress identity, but the legacy generated Compose app still receives the privileged migration connection. A compromised HTTP process could therefore bypass the intended separation. An isolated connection pool alone is not process/secret isolation.

The existing v1.1 one-shot deployment overlay is extended with `--provider-ingress`. It pins both process lifetimes to the **same exact local image SHA-256**: an explicit one-shot `migrate` service and an HTTP `app` service. The runtime receives an explicitly configured, non-superuser SQL principal and the HMAC-only ingress principal; the migration principal is absent from its container environment. The migrator receives no ingress credentials and has a Compose profile so a normal `up app` cannot start migrations implicitly. An image-bound PostgreSQL handoff must exist before HTTP starts. The base Compose is intentionally unchanged for legacy local tests and **must not be presented as isolated**.

The opt-in overlay is restricted to `pia_ckpt_<10 hex>` disposable projects and a new owner-only YAML outside the generated application. It does not provision SQL roles, run a migration, change a real database, or authorize deployment. Role setup remains an explicit operator step. A failed or missing handoff prevents runtime startup. This work does not make a compromised HMAC runtime unable to read its **own** ingress credential; fully separate webhook processes, production secrets management, provider authority and tenant isolation remain outside scope.

## Reproduce on a disposable generated application

Generate both targets from the unchanged workshop contract, then run the existing isolated HTTP probe:

```sh
npm run app:build -- examples/vnext/workshop-itemized-guard --target nestjs --out /tmp/pia-provider-nest
node scripts/vnext/probe-provider-http.mjs /tmp/pia-provider-nest
npm run app:build -- examples/vnext/workshop-itemized-guard --target modular-spring --out /tmp/pia-provider-spring
node scripts/vnext/probe-provider-http.mjs /tmp/pia-provider-spring
node --test tests/vnext/runtime-stage.test.mjs
```

The probe starts a **new disposable PostgreSQL volume**, creates three distinct SQL roles, applies the previously tested journal ACL split, checks the HMAC replay and immutable-journal behavior, then reuses the populated database and the exact Docker image in a second, one-shot migrator/runtime lifecycle. It checks rendered Compose service environments (without printing passwords), absence of migration credentials from the actual HTTP container, absence of ingress credentials from the migrator, refusal to start HTTP before migration handoff, explicit migrator completion, 10-way signed replay, invalid HMAC, no bank settlement, and restart idempotency. The CI marker is `PROTOCOLIA_S2C1C4Q_PINNED_MIGRATOR_RUNTIME_SECRET_BOUNDARY_PASS` **only if those checks complete**.

An operator may create the overlay without starting anything:

```sh
node packages/cli/protocolia.mjs deploy:migrator:overlay <generated-app> --target nestjs --image sha256:<64-hex> --project pia_ckpt_012345abcd --out /private/new-overlay.yaml --provider-ingress
```

The exact local image must already exist, and the runtime, migrator and ingress SQL identities must be independently provisioned. Do not reuse these disposable Compose instructions for production.

## Remaining blockers

This verifies a bounded local process-level separation only. It does **not** prove external provider identity, independent cleared settlement reconciliation, real refunds/chargebacks, multi-tenant production IAM, durable backup/restore, production secret orchestration or third-party business acceptance. Issue #57 stays open. No production deploy, live money operation or stable financial tag.
