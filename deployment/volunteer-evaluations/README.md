# Independent volunteer-evaluation public demonstration

This container image is built from `examples/vnext/volunteer-evaluations/contracts/main.tsp` using `npm run app:build -- ... --target nestjs`. No entity-specific controllers, SQL or UI components are manually supplied. Original sensitive source data must never be deployed. A **free-tier demo only**, not production authorization.

## Render Free

- Repository: barbasmarcosi/ProtocolIA, branch: `independent/volunteer-evaluations`.
- Dockerfile: `deployment/volunteer-evaluations/Dockerfile`; context: repository root.
- Docker build runs official TypeSpec/IR emitters and NestJS/React generation, then copies only generated runtime and compiled static frontend.
- Service URL is assigned by Render after successful deploy; never infer a live URL from this file.
- Use a dedicated Neon PostgreSQL 16 project/database, never GastroApp or TrueMaestro production/staging resources.
- Required env: `PROTOCOLIA_JDBC_URL` (Neon PostgreSQL URI with `sslmode=require`, keep secret), `PROTOCOLIA_ALLOW_DEMO_AUTH=true`, two distinct demo users/passwords in `PROTOCOLIA_READER_USERNAME/PASSWORD` and `PROTOCOLIA_MANAGER_USERNAME/PASSWORD`. Don't include credentials in source, logs, screenshots or test fixtures.
- Public demo Basic auth allows generic reader/manager but **does not** implement guard-specific row authorization or production IAM. Fictitious test data only, no real personnel/grades. Use the Render endpoint HTTPS exclusively.
- Confirm `/health`, generated React static `/`, auth 401/reader, and PostgreSQL persistence through actual restart before claiming LIVE.
- Render Free sleeps on inactivity and Neon Free can autosuspend; don't describe this as always-on SLA.

## Benchmark integrity

An accessible page or manually seeded records do not close BV-08/09/10/11 (computed evaluation/leave rules), BV-01/07 (row/field scope), or BV-14 (export). See `ACCEPTANCE_FREEZE.md` and keep those UNSUPPORTED until actual implementation + tests.
