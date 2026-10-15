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
