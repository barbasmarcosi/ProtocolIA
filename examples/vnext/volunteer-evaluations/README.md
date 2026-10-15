# Independent ProtocolIA trial: monthly volunteer evaluations

Based on an independent real user requirements document, with all identifying data excluded. This is **not** ProtocolIA's Taller, Facility Maintenance, or a renamed sample. See [immutable independent acceptance freeze](ACCEPTANCE_FREEZE.md).

### Build using ProtocolIA, unmodified

```bash
npm ci
npm run app:build -- examples/vnext/volunteer-evaluations --target nestjs --out dist/volunteer-evaluations
npm run app:test -- dist/volunteer-evaluations
```

5 independent entities: Section → GuardDuty → Volunteer → MonthlyEvaluation and LeaveRecord. The generated app will have authenticated CRUD foundation, guarded guard reassignment, bounded points, frozen published-status transition, PostgreSQL audit, per-person/month query and React manifests. This subset must be compiled and tested; writing contracts does not prove the app works.

### Deliberately NOT covered by the compiled subset

- Automatically calculated monthly totals, six-month rolling averages, proportional/medical/accident leave points, and extraordinary leave exclusions.
- Per-field Aide/guard/section responsibilities, guard-specific row-level authorization, account creation, production sign-in.
- Full printable/downloadable summary, template management, historic corrections and calendar-valid monthly uniqueness.

Unsupported behaviors remain in the frozen benchmark and must be counted against the whole 16-item source requirements. Never invent computed totals in the UI. Fake personnel only; do not commit the source document or any photographed roster.
