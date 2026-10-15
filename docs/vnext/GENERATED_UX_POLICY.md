# ProtocolIA — Generated UX Policy (vNext)

**Purpose:** From formal TypeSpec domain/API contracts, generate applications that are **usable**, not merely correct CRUD forms. Keep domain semantics, UX defaults, and visual style separate. Source-derived behavior and permission checks always remain authoritative.

## Architecture and dependency decision

- **TypeSpec + IR** describes authoritative entities, relationships, constraints, capabilities, and operations. Never infer missing permissions or calculations from presentation.
- **UX policy / presentation IR (next increment)** chooses view/interaction patterns based on *domain shape and task complexity* (not on project name). Sensible defaults need no annotations; an optional explicit `@ui`/manifest extension may override presentation only without changing business outcomes.
- **React presentation engine** binds list, search, create, details, state transitions, audit, and errors to generated operations. Share this engine across NestJS, Spring and future adapters, rather than handcrafting per-app forms.
- **Accessible primitives, not DIY focus traps**: use a pinned version of `@radix-ui/react-dialog` for modal focus trapping, Escape handling, background inertness, closing/focus restoration, and named dialogs. Keep the markup/theme owned by ProtocolIA. Reference: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ and https://www.radix-ui.com/primitives/docs/components/dialog .
- Do **not** indiscriminately adopt a complete heavy admin framework or replace all workflows with dialogs. Consider proven dedicated primitives incrementally (TanStack Table for growing datasets, React Hook Form for cross-field form state, and accessible confirm dialogs for dangerous actions), measured on generated apps first.

## Interaction-level heuristics to formalize

| Task | Default | When to use something else |
| --- | --- | --- |
| Quick list/detail | Context-preserving **modal** for short read-only details, actions and concise audit | **Side drawer** for frequent read/compare with the list; full route for long documents, nested navigation and durable shareable links |
| Create simple entity | `Nuevo` action adjacent to list controls, in a dialog | Full route or stepper for multi-step, conditional, large or high-consequence forms |
| Edit small property | Inline/within record context with visible Save and Cancel | Full form if multiple interdependent changes require review |
| Field relationships | Authorized native select for small sets, with loading/empty/error; **never silently submit missing FKs** | Searchable/virtualized relation picker using paginated server query as cardinality grows (current large-list limit must remain explicit) |
| Delete, publish, irreversible action | Separate explicit confirmation, exact object name and capability; safe focus placement | Two-phase approval and audit when contract semantics require it |
| Success/error feedback | Non-blocking status anchored to the operation; actionable server error; preserve filled form on failure | Dedicated recovery screen for unrecoverable network or authentication errors |
| Mobile details/forms | Full-screen dialog/sheet with **internal scrolling**, viewport-safe keyboard interaction and touch-friendly controls | Dedicated page when workflow cannot fit |
| Main list | Keep filters, selection, pagination and scroll location stable when inspecting or editing | Persist URL/route for shareable navigation in a later increment |

## UX0 — implemented first slice in shared React template (independent branch)

- List remains the primary view; remove appended bottom detail/create panels.
- `Detalle` opens an accessible controlled Radix dialog preserving focus and original scroll context; audit/actions appear inside, with internal scrolling. Escape/Close dismisses.
- `Nuevo` appears alongside list heading, opening a responsive dialog; errors/validation are visible in-context and success returns to list.
- On small screens, dialog uses a full-screen layout with independent content scrolling; reduced-motion respected.
- Field/operation capabilities, IR restrictions and PostgreSQL behavior **unchanged**. This is a generative change inherited by all apps using the shared template.
- Validate both Spring and Nest compilation; *real Chromium* must test FK-created Section → GuardDuty → Volunteer → MonthlyEvaluation, computed score, role/dialog semantics, keyboard Tab trap, Escape, focus restoration, mobile bounds and inner scroll. **Only mark UX0 passed after functional CI reports SUCCESS.**

## UX1 — interaction reliability and form usability

- Adopt a consistent command/feedback state machine: pending, success, conflict, validation error, cancellation, optimistic vs confirmed.
- Replace generic 400/409 messages with safely normalized per-field issues where server supports them; do not leak internals.
- Distinguish new vs edit vs read-only consistently, use visible required constraints and cancel/unsaved-change protection.
- Support searchable paginated FK references (not just first 50), explicit empty-state onboarding and invalid/stale choice handling.
- Accessible destructive confirmation and audited transitions with clear action verbs and contextual results.

## UX2 — information architecture and navigability

- Domain labels and user-facing help from contract metadata with locale-aware fallback, not `camelCase` splitting alone.
- Column priorities, sorting, filters, density, truncation/expansion and readable relationship names rather than opaque codes.
- Use heuristics for dialog vs drawer vs full detail page, configurable by **presentation metadata**; an audit/history panel should not force users to scroll through unrelated creation forms.
- State in URL for selected resource/filter/record where safe and authorized; back/forward/history should behave naturally.

## UX3 — real task workflows

- Multiple related mutations and multistep forms from declared contracts; never fabricate business logic.
- Role/capability-centric navigation: show tasks and actions people can complete, not just entity/table names.
- Explicit view of computed/read-only values, provenance and actionable errors; preserve server authority and audit.
- Reuse patterns across **two unrelated independent requirement sets** before calling a UX policy general-purpose.

## Acceptance gates (not subjective visual ratings)

- Detail reachable from row **without manually scrolling**, and Close/Escape returns focus to row action and preserves list context.
- Keyboard navigation stays within open modal; inert background cannot receive interactions. A non-empty accessible title is mandatory.
- A mobile 390x780 viewport keeps modal within viewport and scrollable content within the modal, not in the background.
- Full browser create and detail workflows succeed using real API and PostgreSQL, not DOM mocks.
- Reader vs writer capabilities unchanged; protected data never becomes available via UI-only shortcuts.
- Generated React builds for Nest/Spring, no extra handwritten application code or sensitive fixtures.
- User observation remains the arbiter of ergonomics: automation validates correctness and interaction basics but cannot prove a product is 10/10.

## Deployment discipline

Work on `independent/volunteer-evaluations`; preserve `main` and PR #52. Railway Free uses actual credit; deploy only a CI-proven version. Keep Neon demo seeded exclusively with fictitious data, inspect public health and auth after deployment; do not equate green build with complete UX/production readiness.

## UX0 verified evidence — 2026-10-15

- [Actions #38752413215](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38752413215), functional SHA `3d4782dfbffef5aef16cdaba99420a7b9d93ae9a`, **SUCCESS** for both generated NestJS + Spring Boot with real Postgres source-frozen business oracle.
- Actual Chromium marker: `BV_GENERATED_NATIVE_FK_BROWSER_PASS` with `detailModal:true`, `preservedScroll:true`, `focusRestored:true`, `mobileInternalScroll:true`, `clientJavascriptErrors:0`, four UI-created entities, three FK selects, DB-calculated score 80 and disabled creation when parent missing. Browser asserted focused element stays inside modal across keyboard Tab presses, Escape close, focus returns to originating table action, same scroll position, and 390×780 modal fits viewport with internal overflow.
- The first browser iterations found **real usability and accessibility defects** (implicit scrolled bottom detail, missing explicit `aria-modal`, focus restoration when content was cleared before dialog closed). Remediation is in the shared generated template: Radix controlled dialog with separate open vs selected-record state, `onCloseAutoFocus` returning focus to original row action; default create dialog next to list heading; responsive internally scrollable overlay.
- Unchanged: authorization is server-owned; no unsupported score or leave formulas were added. CI is product-level proof for the UI pattern, **not** a claim that the whole volunteer system fulfills all 16 frozen business requirements.

## UX quality gate — permanent critical review standard (2026-10-15)

Every generated UI change must satisfy the following **observable** criteria before a demo deploy:

- **Legibility, language and semantics:** labels must be understandable to domain users, not leak technical entity identifiers or storage keys as primary information. Use metadata-defined labels first; generic localizable fallback second. The actual referenced public key must remain the value persisted, never the display label.
- **Coherent interaction components:** relation pickers match the rest of the form, have minimum 44px touch targets, name-first rendering, clear placeholder, stable width, internally scrollable list of choices, visible focus/active/selected states and a keyboard-operable combobox/listbox. Use tested accessible primitives; don't simulate selection with non-semantic clickable divs.
- **Nested overlay safety:** choosing a relation preserves the parent modal; first Escape with picker open closes only that picker, and a subsequent Escape dismisses the dialog. Verify Tab/focus return, backdrop inertness, and mobile viewport in real Chromium. If components conflict, coordinate open state centrally in the generated presentation engine, not per app.
- **Async feedback:** never use a bare unexplained `Cargando...` placeholder. Show a contextual spinner and accessible status for initial app load, list refresh, relationship options and audit history, preserving the surrounding layout where feasible. Loading must not impersonate an empty result or allow dependent submissions before references resolve; errors and empty states stay distinct.
- **Reduced motion:** disable nonessential spinners/animations with `prefers-reduced-motion:reduce`; preserve accessible textual status regardless of animation.
- **No cosmetic-only signoff:** technical builds and screenshots are insufficient. Require a real-browser test against generated backend and DB, with HTTP assertions, keyboard interactions, mobile constraints, and a negative-path test. Do not treat compliance in a single independent app as universal proof.
- **Progressively smarter controls:** a finite choice list is appropriate only for small relationship sets. The current adapter **explicitly rejects lists over 50**, and must not silently omit valid options. Next milestone: accessible server-searched, paginated/virtualized entity pickers with cancellation and clear selection validation.
- **Full UX task review:** assess CRUD friction, defaults, cancellation, large forms, table readability, status messages, role-centric navigation, persistence of filters/scroll, success/error affordances, WCAG contrast and keyboard operation. Each real user finding should result in a generic fix or documented contract-level presentation option, not an application-specific patch.

### UX0.1 implemented and empirically verified

- Generated `FormField` reference paths now use pinned `@radix-ui/react-select` and the shared `App.jsx` presentation template. Choices show the name prominently and the immutable reference code secondarily. Local state is coordinated with the modal through `activePicker`, avoiding double-Escape propagation bugs.
- Generated `LoadingIndicator` provides an accessible spinner plus concise status text; a delayed authorized reference-list response was simulated in Chromium and the loading spinner verified before the empty-state message.
- [Workflow #38765432990](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38765432990), functional SHA `d95996e4c8f2f82bca26bf519ee215326563e8a7`, **SUCCESS**. Both generated Spring and Nest pass Docker/Postgres/source-frozen HTTP oracles. Real Chromium created FK-linked entities through the new selector, confirmed the exact stored FK, and verified *Escape closes the nested dropdown without dismissing the form*, as well as retained detail modal, keyboard focus, and mobile behavior. No handwritten business-application components.
- **Not yet solved:** server-side searchable relation lists, full business-localized contract metadata, sophisticated skeletons/transition delays, visual regression baselines and role-based task dashboards. The improved select and spinner alone do not constitute a premium UX rating.

## UX0.2 — actionable validation and human-readable relationship summaries (2026-10-15)

**Real-user reports:** A `MonthlyEvaluation` form submitted period `123` and responded only `Revisá los datos ingresados.`; it exposed the contract's fixed initial state `draft`. A `GuardDuty` table displayed an opaque `SEC-DEMO` FK and browser-native tooltip; success banner leaked the verb `create`.

Implemented once in `packages/adapters/modular/templates/web/src/App.jsx` (shared by generated NestJS and Spring Boot frontends):
- Validate the contract's `required`, `min/max` int32 and `minLength/maxLength` string bounds before HTTP. Mark errors on the exact control with `aria-invalid`, described inline via `aria-describedby`; keep user inputs intact and focus the first invalid field. Validation is **not** a substitute for the server.
- A `period` string with exact 7-character constraint uses HTML month input and expects ISO `YYYY-MM`; **current fallback heuristic**, not a new TypeSpec/IR `@format` capability. Formal `year-month` format metadata with backend parity is a follow-up.
- Initial-state fields (e.g. `status=draft`) remain sent as contract-prescribed values but are no longer editable inputs during create; the details/list can show human-friendly labels.
- Replace `Operación confirmada: create` with an understandable success message. Reference columns/details use the related record's authorized display name as primary text with the exact immutable key shown in subdued secondary text. If no authorized related record was fetched, fall back to its key; **no unauthorized relationship fetches**.
- Remove browser-native `title` tooltips from table cells; retain accessible readable text and action buttons.
- Generated feedback and inputs get visible error borders and accessible contextual hints.

**Regression evidence:** Real generated Chromium workflow [#38769690176](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38769690176) **SUCCESS**, both NestJS and Spring Boot Docker/PostgreSQL/API jobs, and Chromium `BV_GENERATED_NATIVE_FK_BROWSER_PASS`. Browser checks both an invalid 26-point incident input (contract allows 0–25), `aria-invalid`, no HTTP persisted invalid record, a valid `2026-09` month, read-only initial status omission, meaningful relation columns, no native tooltip, friendly confirmation, four-entity FK creation and computed 80-point total. Initial iteration had incorrectly escaped the month validation regexp and **rejected valid `2026-09`**: a real failure captured in GitHub Actions screenshot, then fixed before promoting. Positive and negative cases now both pass.

**Live rollout:** Railway Free deploy `86974af3-3a39-45b2-86a8-caa91f398ea0` **SUCCESS**; external `/` served the React login, `/health` reported `{"status":"UP"}`, and anonymous `/api/guards` was HTTP 401. Dedicated Neon read-only SQL confirmed the fictional Sep/Oct stored scores still **80/100**. No schema migration, no real volunteer identities. `main` and integration PR #52 unchanged.

**Still critically incomplete:** expose `@format("year-month")` or equivalent compiled metadata to validate months identically on both backends; bind server 400 responses to structured field-specific errors (instead of an undifferentiated generic message for failures not caught by client validation); generate friendly labels and enumerated choices from explicit domain metadata; provide searchable/paged reference controls beyond 50; implement field-level edit flows and test all screen sizes; improve loading skeletons and meaningful data hierarchy. Current improvements are a verified UX slice, **not** a fully polished domain application.
