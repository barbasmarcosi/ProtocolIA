# S2c-1b2 — mobile authorized financial correction editor

Frozen 2026-10-31. Based on merged S2c-1b1 #68 (`27710a45`). Purely generated React UX using already verified contract `@behavior("adjustExact")`, not new server money semantics.

Acceptance:
- Render on a parent detail view only when a reviewed exact reconciliation exposes `adjustmentJournal=true`, the authenticated user has the separate `orders.adjust` capability, and the user also has rights to read the ledger. No new unauthenticated operation or generic monetary PATCH.
- Present *increase* versus *decrease* explicitly; positive amount as a string, source contract precision/scale with base-10 BigInt only, reason 12–240 chars, no client-supplied parent/balance/actor, server-derived adjustment ID, one in-flight POST at a time.
- Require two distinct interactions: first **review** fetches a new source-backed reconciliation (and rejects stale opening/available/posted/reversed/preview headroom); second **confirm** is the only action invoking the write POST. Preview/review must not mutate the journal. Display before/after total and available and signed delta, including confirmation of reason.
- Use the same protected API route, with authenticated actor server-side. Handle 400/401/403/404/409 and network uncertainty without automated retries or duplicate submissions. On success, refresh ledger and selected parent, reset editor and notify. Keep adjustment IDs stable after unknown outcomes to avoid accidental double creation; a repeat ID returns 409.
- Do not render a write editor when the ledger is unbalanced, when signed headroom is unavailable or when user lacks the capability. Responsive modal at 390×844, touch targets, keyboard accessibility, no horizontal overflow or JS errors.
- Both generated NestJS and modular Spring: real PostgreSQL + HTTP + Playwright browser acceptance, show exact no-mutation-before-confirm and legitimate +0.05 correction on a fresh order with original +1.00, source stays immutable. Full prior signed POST/race regression, itemization/source drift tests, initial receipt regression and quality 5/5 remain green.

This UI does NOT implement refund settlement, taxes, VAT, credit notes, payer approval, production backup, tenant IAM or production launch. Do not tag stable financial or close TL-14/#57.
