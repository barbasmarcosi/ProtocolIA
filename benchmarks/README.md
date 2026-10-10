# ProtocolIA benchmark registration (P0 scaffold)

This folder is a **preregistration scaffold**, NOT a benchmark result. It contains a pinned catalog of two P0 smoke fixtures and an explicit machine-readable record format. Both fixtures are public; **neither is P4 held-out evaluation data**. Do not use them to claim token savings, cost reductions, formal correctness or model performance.

- `task-registry.json`: exact repository/commit/fixture for P0 repeatability.
- `run-record.schema.json`: strict JSON Schema 2020-12 for recording measurements, outcomes and independently inspectable evidence.
- No run-record values are fabricated; missing cost/tokens/time must be `null`, **never interpreted as zero**.
- For provider-free smoke compile, do **not** equate an API schema/TS typecheck with a successful software mission.
- P4 must lock genuine held-out tasks and independent result oracles before any compared agents are run; use the same model/stack/budget and preserve failures.
- Primary decision criterion: cohort-level total cost divided by independently verified successes, reported with completion rate and uncertainty. Never compare only successes or only generated lines.

The P4 benchmark requires a separate preregistration with task splits (greenfield CRUD, domain invariants, brownfield updates, adverse prompts, and algorithms), model versions, allowed tool inventory, sampling policy, evaluation oracles and exclusion criteria. ProtocolIA may lose to an ordinary generator and such results must be reported.
