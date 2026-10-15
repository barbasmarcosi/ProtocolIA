# UX5 Railway live acceptance — 2026-10-15

## Verified deployment

- Railway service: `volunteer-evaluations-web` on Railway Free.
- Pin: `7646ae371d7e8963ed1a3894518740b40782820b`.
- Deployment: `158ce6b5-cb0e-406f-9a90-c108ce302aad` — **SUCCESS**.
- Public frontend: https://volunteer-evaluations-web-production.up.railway.app/
- Independent HTTP fetch confirmed `/health` returned `{"status":"UP"}` and `/` rendered the generated Spanish login application, titled "ProtocolIA — aplicación generada".
- Railway runtime logs recorded `PROTOCOLIA_NEST_MIGRATION_APPLIED 2` and `PROTOCOLIA_NEST_STARTED` (5 generated entities, 23 operations).
- Read-only Neon verification recorded migration journal V2 applied and two validated `chk_pia_*` constraints matching the anchored year-month pattern.
- Existing fictitious data preserved: monthly evaluations **3/3 valid** and leave records **1/1 valid**. Zero invalid periods. No names, credentials, or identifying source records were read or published.
- Railway HTTP traffic after deployment confirms generated static assets and manifest are served successfully.

## Failure and correction

The first candidate `bd2a30cf` failed only at Docker build (deployment `55d1c320-00a5-4f29-9bac-1ac85293262f`). The immutable UX4 build and UX5 evolution ran in separate Docker layers; an atomic directory rename failed with `EXDEV`. The Dockerfile now executes them within one writable layer; the identical production image was built and inspected in [isolated overlay CI](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38805403072). The final official branch integration [passed Nest/Spring/PostgreSQL/Chromium](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38805757827).

## Scope limitations

This is a public fictitious demo, not permission to use real volunteer identities or grades; Basic demo auth is not production IAM and user-specific row authorization remains outside scope. Railway Free may sleep due to inactivity. HTTP health and startup success are not a guarantee of always-on service or complete accessibility. UX6 draft protection is a separate, unpromoted feature branch pending validation.
