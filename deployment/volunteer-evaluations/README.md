# Independent volunteer-evaluation public demonstration

This container image is built from `examples/vnext/volunteer-evaluations/contracts/main.tsp` using `npm run app:build -- ... --target nestjs`. No entity-specific controllers, SQL or UI components are manually supplied. Original sensitive source data must never be deployed. A **free-tier demo only**, not production authorization.

## Railway Free — deployment alternative (requires account connection)

Render build is blocked because the current workspace's free build-pipeline minutes are exhausted. This guide prepares deployment without purchasing another tier. Railway Free currently gives a **limited** monthly usage credit; verify your Railway workspace is on the Free plan before enabling deployment. Do not enable pay-as-you-go charges.

1. Connect Railway to ChatGPT, or in Railway create a project → **Deploy from GitHub repo** → `barbasmarcosi/ProtocolIA`. Select **branch `independent/volunteer-evaluations`**, with **repository root** as the build context (do not select the subdirectory as root).
2. In Railway service variables set `RAILWAY_DOCKERFILE_PATH=deployment/volunteer-evaluations/Dockerfile` so the image is generated from TypeSpec rather than detecting an unrelated Dockerfile. Leave `PORT` to Railway's injected value; the generated Nest backend binds to `0.0.0.0`. The same container serves React static assets.
3. In Railway variables, use **only fictitious demo credentials**: `PROTOCOLIA_ALLOW_DEMO_AUTH=true`, `PROTOCOLIA_READER_USERNAME`, `PROTOCOLIA_READER_PASSWORD`, `PROTOCOLIA_MANAGER_USERNAME`, `PROTOCOLIA_MANAGER_PASSWORD`. Generate strong distinct random passwords privately. **Never put credential values into commits or public environment templates.**
4. Open the existing dedicated Neon project `protocolia-volunteer-evaluations-demo`; copy its connection string into Railway **secret** variable `PROTOCOLIA_JDBC_URL` with `sslmode=require`. This manual approved secret handoff is required: direct credential transfer from Neon to Render via ChatGPT was blocked by a security control. Use only the isolated demo Neon project, never another application's database. There is no separate `DATABASE_URL` mapping in the generated app.
5. Set Railway healthcheck path `/health` and timeout sufficiently long for the first PostgreSQL schema initialization (for example, 180 seconds). Expose an HTTP public domain only after the service is healthy. Verify a real 200 from `/health`, that `/` returns the generated React page, and demo login/list/create/read work; then restart and re-read a fictitious record to prove Neon persistence.
6. A publicly exposed demo's Basic credentials are not production IAM: no row-scoped volunteer privacy, no real personnel data, no guarantee of always-on availability under Free credit. Avoid advertising the endpoint as production-ready. Railway hosting/live status must be independently checked; the existence of this config is **not** evidence of a successful deploy.

**Status at authoring:** Railway integration was suggested but is not yet connected. No Railway service or live domain is claimed.

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
