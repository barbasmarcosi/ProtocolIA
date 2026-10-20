# UX9 — Manifest-scoped navigation, history and draft safety (2026-10-15)

## Scope and implementation

The shared React generator at `packages/adapters/modular/templates/web/src/App.jsx` now derives a URL route exclusively from the compiled TypeSpec/IR UI manifest. This is **generic generated UI**, not volunteer-evaluation-specific implementation.

- `?resource=<entity name>` selects only a declared resource; an unknown resource fails to the first declared entity.
- `offset=<nonnegative multiple of 25>` is restored with a bounded URL parser, and `filter.<declared query parameter>=value` restores only filters explicitly supported by the selected manifest's authorized `queryPage`. Unknown filter keys are discarded when normalizing the route.
- Switching resource pushes a browser history entry. Updating a page/filter replaces the current history entry instead of creating a Back-button entry per keystroke.
- Separate resource snapshots keep applied/draft filters and pagination when users navigate away and back within the session.
- `popstate` accepts Back/Forward and restores the manifest-selected resource, page and filters, without changing HTTP auth/capabilities.
- An unsaved creation form cannot be replaced by history navigation until the user explicitly discards the draft. **Continue editing** reverses the pending history movement; the source form and values remain intact. Existing form-level Cancel/Escape/outside-click protections remain.
- While a create mutation is in flight, history switching is reverted without presenting a misleading discard action. Stale asynchronous list responses cannot overwrite another resource after a fast navigation.

## Evidence and release status

- Staging branch: `feature/ux9-generated-url-navigation-20261015`, based on `independent/volunteer-evaluations`; `main` and PR #52 are outside scope.
- Baseline end-to-end staging gate [GitHub Actions #38823375422](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38823375422) **SUCCESS** on both generated NestJS and Spring Boot with PostgreSQL, independent frozen HTTP oracle, and Chromium. Marker `BV_GENERATED_NATIVE_FK_BROWSER_PASS` contained `urlNavigation:true`, `historyDraftGuard:true`, and `clientJavascriptErrors:0`.
- This source includes subsequent extra reliability changes and a Chromium regression for filter preservation; those must be validated on the exact final SHA before releasing to Railway. A previous gate's success must **not** be presented as proof of untested later code.
- Requirements outside UX9 remain deliberately unchanged: complete leave calculations, row/field-scoped production IAM, business scoring, exports, production backup/restore.

## Known boundaries

- Direct resource URLs do not encode arbitrary detail record IDs or open mutation dialogs; those need explicit capability-aware record routes and authorization.
- The URL includes user-applied filters by design. Users should not place secrets in filter values or share URLs containing confidential searches.
- History restoration applies to navigation within the generated React app. Cross-origin unloads are handled by the browser's best-effort `beforeunload` warning.
- UX9 does not declare general workflow-page routing, server-side session restore, or offline draft persistence.


## Official gate and deployed demo — verified

- Verified application source: `e0c6ca2ed909ed3b87641fe656befb402981d263` (the UX9 implementation, browser probe and UX policy, with temporary staging CI removed).
- Official independent generated-app integration [#38824364322](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38824364322) **SUCCESS**: both NestJS/PostgreSQL/Chromium and Spring Boot/PostgreSQL/source-frozen business oracle. Chromium marker confirms `urlNavigation:true`, `historyDraftGuard:true`, `clientJavascriptErrors:0`. Browser source explicitly asserts URL filter restoration.
- Official general quality [#38824364242](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38824364242) **SUCCESS** on the exact release source.
- Railway service `volunteer-evaluations-web`: deployment `9127a7f8-0ed8-4b6c-9273-febc9d8fb5fd` reached **SUCCESS** from the pinned exact release SHA. Runtime log `PROTOCOLIA_NEST_STARTED` reported **23 operations** and **five declared entities**.
- An independent public read-only HTTP probe after deployment observed `/health` with `{"status":"UP"}`; `/?resource=GuardDuty` returned the generated Spanish login screen with heading **Guardias**; unauthenticated `/api/guards` returned **401**. This is not a claim that an external browser exercised an authenticated end-to-end mutation on the live instance; that was independently tested against generated PostgreSQL applications in CI.
- Read-only Neon checks after deployment: `monthly_evaluation` **3** fictitious records and `leave_record` **1** fictitious record; **zero** invalid year-month periods in both; **two** validated `chk_pia_*` PostgreSQL constraints.
- The repo's `main` and PR #52 remain out of scope. The public demo is a test-only application, not production-ready IAM, and the 16 frozen customer requirements are **not** declared fulfilled.
