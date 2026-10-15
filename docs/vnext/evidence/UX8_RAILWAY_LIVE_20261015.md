# UX8 — Railway live deployment verification (2026-10-15)

## Release identity

- Repo: `barbasmarcosi/ProtocolIA`, independent branch `independent/volunteer-evaluations`.
- Exact deployed SHA: `e38c8826b298c39ef36481feb1dfb3630619b440`.
- Railway service: `volunteer-evaluations-web` on free resources, deployment `c6191134-23dd-488c-ad21-1634e9cfd964`, status **SUCCESS**.
- Demo: https://volunteer-evaluations-web-production.up.railway.app/
- Runtime deployment logs show `PROTOCOLIA_NEST_STARTED` with the five generated entities: GuardDuty, LeaveRecord, MonthlyEvaluation, Section and Volunteer. This is a verified running deployment, not just a green Docker build.

## Integration and visual gate

- [Independent integration #38811532715 — SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38811532715), generated NestJS and Spring Boot with PostgreSQL and Chromium.
- [General quality #38811532477 — SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38811532477).
- [UX8 staging and screenshots #38811084350 — SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38811084350); [visual artifact](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38811084350/artifacts/12008731554).
- Captures were opened and visually inspected: the compact mobile create form no longer occupies an empty fullscreen surface; desktop and complex mobile workflows keep established layouts.

## Database preservation

Read-only Neon checks after the UX8 Railway startup showed:
- `monthly_evaluation`: 3 fictitious records, 0 invalid year-month periods.
- `leave_record`: 1 fictitious record, 0 invalid periods.
- Two `chk_pia_*` contract-domain constraints remain validated.
- No personal identifiers or passwords were extracted.

## Honest limitations

An external HTTP fetch after this specific UX8 deployment was unavailable from the current environment (external DNS / web access restriction). Railway itself reports `SUCCESS` and its runtime logs confirm a started service; do **not** substitute that for an independently measured public `/health` result for UX8. The prior UX5 release had a separate successful external health probe. Railway Free may sleep when idle; that is not intrinsically a deploy failure.

This release does not close server-side row-scoped authorization, task-oriented route navigation, general regex patterns, or all application-specific scoring rules marked unsupported by the frozen acceptance requirements. Keep `main` and PR #52 unchanged.
