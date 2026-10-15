# UX8 — Adaptive generated mobile create forms

**Status:** isolated implementation pending full backend/browser and visual validation.

The shared generated React form now selects a compact mobile bottom sheet only for simple tasks with up to four editable fields and no relationship selectors. Longer/relational workflows retain the established full-screen scrollable dialog. The decision is derived entirely from the contract manifest; no VolunteerEvaluations field or model names appear in the implementation.

The compact sheet respects dynamic viewport units, device safe area, internal scroll, modal focus trapping, and the existing draft-discard confirmation. Desktop layouts are unchanged. Browser gates assert a real short form has an anchored bottom sheet below 85% viewport height, while a long monthly evaluation form occupies the full-height mobile layout; both backend outputs retain independent PostgreSQL conformance. A new mobile screenshot is saved for visual inspection before promotion.

Known limit: number of fields is a practical initial complexity heuristic, not a complete representation of cognitive load. Future TypeSpec task metadata may improve layout intent while remaining distinct from authoritative business rules.
