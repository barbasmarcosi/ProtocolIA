# S2c-1c4b — immutable sandbox lifecycle observation journal (SQL only)

Date: 2026-10-31. Base `main` `78aae475df7660e9a2cf362885ce7248db1409af`. TL-14 / issue #57 remains **OPEN**.

## Purpose and boundary

The signed `receipt-candidate.v1` ingress establishes **one** synthetic provider-to-internal-receipt association, but a subsequent callback must not create a second candidate. This increment generates an append-only PostgreSQL observation journal in **both NestJS and Spring** from the same canonical `providerCandidate` binding. It stores *reported* lifecycle signals against the existing candidate; it **does not authenticate an HTTP callback, settle money, change a receipt, or update `providerSettlementState`**.

The phases `reported_pending`, `reported_success`, `reported_failure` and `reported_reversal` are **untrusted synthetic reports**, not banking truth. Their names intentionally avoid asserting independently verified clearing. The integer `event_sequence` is scoped to one receipt and must be positive and exact; arrivals may be out of order (3,1,2) and are only journaled, never applied to a financial state projection.

## Invariants

- A lifecycle observation must reference the **same trusted provider, candidate event, receipt, order and exact amount**. A composite PostgreSQL FK prevents mismatched direct inserts even if a caller bypasses the generated SQL function.
- `(provider_id,event_id)` uniquely identifies a signed envelope; `(receipt_id,event_sequence)` is unique across events. The signing key is not part of event identity. The immutable candidate row serializes competing observations. The journal has an UPDATE/DELETE-denying trigger.
- Existing event + same digest and claims returns `duplicate` **before** reading mutable payment status, including after internal reversal. Altered digest or claims return `conflict`; an unrelated digest-only inbox event cannot be promoted into a lifecycle observation.
- New events require a preexisting matching candidate and a still-posted internal receipt. Missing, mismatched, reversed, fractional/negative/overflow sequence or invalid phase/amount are rejected without creating an inbox fragment. Rollback leaves no observation or envelope.
- There is deliberately **no gap-filling, last-event-wins or settlement projection**. A future provider-specific authenticated processor must validate authority, ordering semantics and reversals before changing any financial state.

## Reproducible acceptance

`.github/workflows/v12h-s2c1c0-provider-envelope.yml` regenerates the unchanged TypeSpec fixture independently for NestJS and modular Spring and executes `node --test tests/vnext/provider-envelope-inbox.test.mjs` and `node scripts/vnext/probe-provider-inbox.mjs <generated-app>` against disposable real PostgreSQL. The probe checks out-of-order arrival, ten simultaneous identical events (1 stored/9 duplicates), ten distinct events racing on one sequence (1 stored/9 conflicts), cross-provider/candidate mismatch, invalid numeric values, rollback, immutability, stable replay after reversal and zero financial mutation. The existing signed HTTP sandbox probe and exact finance regressions must also remain green.

**CI results must be recorded separately from this specification.** No external provider requests, production deployment, financial operation or stable finance tag.

## Next gate

S2c-1c4c: a separately versioned strict signed **sandbox HTTP lifecycle** envelope, server-pinned provider identity, candidate correlation, adversarial JSON/HMAC/sequence tests. Only later: provider-specific verified authority, causally valid settlement transitions, refunds/chargebacks, tenancy, key management, backups and independent business acceptance.
