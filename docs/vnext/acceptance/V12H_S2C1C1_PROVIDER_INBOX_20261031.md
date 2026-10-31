# S2c-1c1 — atomic provider-envelope inbox, acceptance and safety boundary

Date: 2026-10-31. Base `406c8480e7f4b10ed4419e3542190e3ce216774b`, PR #76. This is an independently generated, **dormant PostgreSQL storage primitive**, not an externally verified settlement. TL-14/#57 stays OPEN.

## Authority and invariants

The existing S2c-1c0 Node/Java HMAC-SHA256 verifier authenticates a provider-neutral signed envelope. A future HTTP adapter MUST derive the provider identity from trusted server configuration, verify the **raw** bytes and signed headers, and only then call the inbox in the same database transaction as any subsequent authorized state transition. Neither signing key ID nor a client-supplied provider field is allowed to define replay identity.

Canonical exact reconciliation with an explicit `unverifiedProofField` is the only opt-in for provisioning the inbox. Both generated targets emit the same SQL table and `protocolia_record_provider_envelope_digest(provider,event,digest)` function. The unique key is `(provider_id,event_id)`; the SHA-256 digest is immutable. Outcomes: `stored` on first commit, `duplicate` on same digest, `conflict` on same key with different digest. Input violations raise SQLSTATE 23514; an indeterminate concurrency read raises retryable SQLSTATE 40001. The database uses a primary-key conflict arbiter, not a read-then-insert race. UPDATE/DELETE of stored records are rejected by trigger. The inbox never changes receipts, orders, provider proof state, audit or settlement.

## Executable acceptance

`node scripts/vnext/probe-provider-inbox.mjs <generated-app-directory>` starts a disposable PostgreSQL 16 Docker Compose database, loads the **actual generated schema** for the target, and verifies: 10 concurrent same-key/same-digest requests yield exactly one `stored` and nine `duplicate`; changed digest yields `conflict` without overwrite; same event ID in another trusted provider namespace stores independently; malformed IDs and digests fail without rows; rollback-before-commit leaves no claim and permits retry; direct UPDATE and DELETE fail; zero payment rows are touched. All data are synthetic and Docker volumes are deleted afterward.

Run this separately against generated NestJS and Spring projects from the **same unchanged TypeSpec**. Keep existing cross-language HMAC, real PostgreSQL/HTTP app conformance, S2a/S2b finance regressions and quality jobs green. CI results and actual SHAs must be recorded only after successful execution.

## Unproven and forbidden claims

No HTTP webhook endpoint, provider-specific signature configuration, provider-acknowledgement protocol, event-body semantic validation, externally confirmed money, refund, chargeback, bank idempotency, production tenancy, retention policy or production recovery is implemented by this milestone. A database writer could call the inbox function without HMAC verification; it is NOT a public API. In particular, never commit a standalone inbox claim and subsequently assume business processing completed. The future handler must atomically join replay insertion with authorized processing or implement a separately reviewed durable retry/processing state machine.

Next milestone: authenticated provider-specific raw HTTP boundary, trusted provider identity/key management, deterministic acknowledgements and end-to-end replay/timeout/rollback tests in both runtimes. Only then consider a separately reviewed, receipt-linked external proof transition. No production deployment, finance tag or real provider requests.
