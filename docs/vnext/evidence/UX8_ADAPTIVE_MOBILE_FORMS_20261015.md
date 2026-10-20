# UX8 — Adaptive generated mobile create forms

**Status:** isolated implementation pending full backend/browser and visual validation.

The shared generated React form now selects a compact mobile bottom sheet only for simple tasks with up to four editable fields and no relationship selectors. Longer/relational workflows retain the established full-screen scrollable dialog. The decision is derived entirely from the contract manifest; no VolunteerEvaluations field or model names appear in the implementation.

The compact sheet respects dynamic viewport units, device safe area, internal scroll, modal focus trapping, and the existing draft-discard confirmation. Desktop layouts are unchanged. Browser gates assert a real short form has an anchored bottom sheet below 85% viewport height, while a long monthly evaluation form occupies the full-height mobile layout; both backend outputs retain independent PostgreSQL conformance. A new mobile screenshot is saved for visual inspection before promotion.

Known limit: number of fields is a practical initial complexity heuristic, not a complete representation of cognitive load. Future TypeSpec task metadata may improve layout intent while remaining distinct from authoritative business rules.

## Final independent acceptance

- [Full generated NestJS/Spring Boot/PostgreSQL/Chromium #38811084350 — SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38811084350).
- [9 original UX screenshots plus compact mobile screenshot](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38811084350/artifacts/12008731554) were generated in Chromium; the new `protocolia-generated-compact-create-mobile.png` was opened and visually inspected.
- A short, non-relational form is rendered as a compact bottom sheet; Chromium measures its height below 85% of the screen and its bottom edge anchored to the viewport.
- A longer monthly evaluation form remains full-height and scrollable; keyboard/focus, draft loss guard, backend field errors and parent/child CRUD regressions remain successful.
- The compact screenshot shows a clear title, contextual help, two-column-safe mobile input stack, inline validation message and visible primary/secondary actions without large wasted blank space.
- Screenshots and test records contain only synthetic identities.

Limitations: a count-based selection is a practical baseline, not a substitute for future contract-defined task complexity. No complete redesign of details/edit flows or user studies are claimed.
