# G3 — Schema-driven Books UI and real Chromium E2E evidence

**Gate:** G3 **VERIFIED for the bounded Books v0.3 slice** — *not a generic full-stack UI generator or production-ready service*.  
**Exact executable/tested SHA:** `eeff8a628ca9a3487ef6a9b50b9797425c4a4f96`.  
**Render Free service:** `srv-db6l6stg1s2s739pr5m0`, deploy `dep-db6lbbd9fdbs73fqr6h0` — **LIVE**.  
**Public UI:** https://protocolia-g3-books-rjsf-20261012.onrender.com/  
**Public proxy health:** `GET /health` independently returned `{"status":"UP"}` after JVM startup.  
**P4 study:** unchanged; no GitHub Actions minutes or paid model API usage.

## What was built

- **React 19.2 / TypeScript / Vite 7.1.9** handwritten responsive UI shell: login, real Books paginated list, selectable detail, create and adjust-stock panels, loading/empty/error/unauthorized states, and mobile layout. UI is not claimed to be produced end-to-end automatically.
- **RJSF 6.7.1 + AJV 8.17.1 with explicit Ajv2020** for JSON Schema draft 2020-12; actual input fields and validation rules come from ProtocolIA `payload.schema.json` `$defs/BookRequest` and `$defs/StockAdjustment`.
- **Fields/titles/order/actions** are read from the verified `ui-manifest.json`; `src/protocolia-ui/bindings.ts` rejects unsupported role, field, model reference, resource ID and invalidation drift. This metadata does not grant security permissions.
- **Orval 8.41.0 / TanStack Query** (verified G2) own HTTP functions, typed DTOs and query hooks. `src/api/http.ts` and `src/api/cache.ts` remain user-owned; create/adjust success invalidates list-page variants and detail, without relying on UI-only state.
- **Authorization:** no real credentials embedded in client JS. Tester enters them in the browser; Basic header is assembled in memory. Credential changes clear QueryClient so cached data of one identity cannot carry across sessions. Role selector is only a UI hint; Spring enforces catalog.read/catalog.write on every endpoint. Viewer POST rejection was observed as HTTP 403.
- **Preservation:** generated Orval API/DTOs remain disposable, and repeated generation does not modify user-owned HTTP/cache code.

## Execution evidence at exact tested code SHA

Pinned `examples/books-web/package-lock.json` from actual npm dependency resolution; Docker uses `npm ci`.

The G3 Docker build regenerates the truthful G0 target-specific OpenAPI/JSON Schema/manifests from the real Books v0.3 contract, regenerates the Orval SDK, compiles TypeScript in strict mode and Vite bundle; builds the verified G1 Java 21 / Spring Boot 4.1.1 app; starts that app at **127.0.0.1:10111**; serves the **built Vite preview** at **127.0.0.1:4173**; executes Playwright **1.56.1** with actual Chromium. No mock HTTP server or production/public data mutation.

Actual build markers:

- `G3_RJSF_TYPESCRIPT_AND_BUILD_PASS` — TypeScript typecheck, Vite build, manifest checks and Orval regeneration gate succeeded.
- `G3_PUBLIC_HOST_ALLOWLIST_AND_UNKNOWN_HOST_DENIAL_PASS` — built Vite preview serves the **explicit Render hostname** and same-origin `/health` proxy as HTTP 200; an unapproved Host header gets HTTP 403.
- `3 passed (3.7s)` and `G3_REAL_BROWSER_E2E_PASS` — all three real-browser tests passed:
  1. Reject whitespace-only ISBN, stock -1 and adjustment quantity 0 without submitting writes; create two Books, load detail, adjust stock from 2 to 9 and observe refresh, paginate at one record per page and navigate back.
  2. Show wrong-password HTTP 401 in the UI; render reader mode without write controls; confirm the backend independently rejects a reader POST as HTTP 403.
  3. Repeat reader workflow on **390×844** mobile viewport without document-wide horizontal overflow.
- Render deployment `dep-db6lbbd9fdbs73fqr6h0` reached **LIVE**. A remote JS-rendered request successfully read the public React login screen. A separate independent external request confirmed `/health -> {"status":"UP"}` after Java finished cold start.

## Negative findings retained and resolved

1. Initial RJSF/Ajv2020 constructor typing and form-schema-to-generated DTO bridge failed strict TypeScript; repaired at a narrow, documented AjvClass typing boundary and by relying on RJSF validated data.
2. The first public image ran non-root correctly but Vite preview could not write `.vite-temp` under root-owned node_modules; permission granted **only** on that disposable scratch directory. The whole application is **not** run as root.
3. The public Render hostname was initially rejected as HTTP 403 by Vite host checking; fixed by allowlisting **exactly this domain**, not disabling the protection. Verified negative unknown-host case.
4. Render Free's JVM cold start took roughly **50 seconds** in this deployment. Public `/health` initially failed through the proxy while Java started and subsequently responded `{"status":"UP"}`. Public display of the login page is therefore not proof of backend readiness during cold starts.

## Definition of DONE and limits

**G3 is accepted for Books only.** Schema-driven simple form fields, manifest-derived list/detail and user-owned React shell work end-to-end in a real browser, with explicit error/permission and mobile coverage. No claim of arbitrary form layouts, full metadata-to-UX synthesis, SQL generation, durable storage, complete accessibility audit, or productivity improvement. RJSF's use of AJV2020 covers this concrete simple schema; it is **not** blanket validation of all JSON Schema 2020-12 constructs.

**Production blockers:** in-memory Basic-auth demo, client-held transient Basic credentials, Vite preview serving as a combined free-tier demo, no persistent DB, no OAuth2/OIDC/JWT capability mapping, and limited browser coverage. Do not treat this deployment as production-ready.

**Next planned gate:** G4 trusted OAuth2/OIDC resource server + explicit capabilities and Schemathesis property-based API checks. G0 broader nullable/error-body compatibility and G5 persistent DB/regeneration remain open.
