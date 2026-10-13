# G5 second resource — Widgets contract-only code generation

This independent `version:"0.4"` fixture defines `Widget`,
`WidgetRequest`, `WidgetPage`, `UnitAdjustment` and five contract
operations. It is a proof that the reusable generation engine is not hardwired
to Books names or paths.

The accepted G5 Docker build runs `regenerate-fullstack` with
`examples/widgets-web` as a separate pinned Orval template. It emits Java API
interfaces, typed TS/Orval client and validated UI/capability/ownership
manifests. Its optional field evolution and negative role-binding test run
under `tests/test_v04_second_resource.py`.

**Limit:** this fixture intentionally does not include handwritten widget
business implementations, a real PostgreSQL schema or an interactive Widgets
UI. Those are never generated or invented automatically; this is a separate
**codegen reuse test**, not an independent production app.
