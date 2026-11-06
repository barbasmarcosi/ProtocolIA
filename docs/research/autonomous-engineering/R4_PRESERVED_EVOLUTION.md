# R4.1 — preserving Passport and persisted PostgreSQL state through additive evolution

**Status:** experimental CI acceptance candidate. A successful isolated test is not production migration approval, independent-agent reasoning, fiscal certification, or confirmation of an externally authenticated owner's business rule.

## Failure this closes

The existing `app:evolve` regenerated a clean app from a new TypeSpec project, without forwarding `--passport`. A source-bound application thus lost its portable Passport, saved TypeSpec, handoff guide and declared requirement/decision inputs on its first additive regeneration. Retaining DB rows is not sufficient if maintainers lose evidence of the canonical contract.

The generator now detects a prior `protocolia-build.json.passport` and automatically regenerates a **new** Passport from the **updated** TypeSpec. Any bundled `requirements.json` and `decisions.json` are carried over only as **declared, unverified** source claims; unknown newly introduced behavior is not relabeled as approved, and no test status is auto-promoted. The new generated application includes a revised IR, source SHA-256, immutable source copy, embedded verifiers and a refreshed ownership seal. No Passport is added to apps that did not originally opt in.

## Controlled PostgreSQL acceptance

The [R4 maintained evolution workflow](../../.github/workflows/r4-preserved-evolution.yml) runs both independent generated targets (NestJS and modular Spring) against ephemeral PostgreSQL 16 services.

1. Build the original Taller application from its authoritative TypeSpec with `--passport`. Verify the emitted source snapshot and clone **only** that snapshot into a fresh project directory.
2. Start the generated app, insert two distinct tools and record exact identities, names, quantities. Assert unauthorized reader creation fails (403) and duplicate creation fails (409).
3. Stop the app. Edit the **rehydrated** TypeSpec to add a bounded optional/nullable `serviceNote` to the Tool entity and its request model, without modifying existing operation permissions or business behavior.
4. Run `app:plan`, require a compatible additive field change. Then run `app:evolve` in its explicitly **unverified disposable development mode**, rather than changing live infrastructure.
5. Verify the regenerated app still includes the handoff guide, exact updated TypeSpec source, Passport, standalone verifiers, changed fingerprints and ownership seal.
6. Restart with the **same populated PostgreSQL database**. Require both prior rows to remain intact. Create a third row with the newly supported field, exercise the existing atomic quantity increment and reject unauthorized/duplicate operations.
7. Stop the app and attempt to tighten the formerly optional `serviceNote` to required, forcing a breaking evolution. Require both `app:plan` to reject compatibility and `app:evolve` to exit non-zero without modifying the previously sealed app.
8. Restart again against the same database and check all three rows, quantities and serviceNote values survived.

Success markers are `PROTOCOLIA_R4_PERSISTENT_EVOLUTION_AND_PASSPORT_nestjs_PASS` and `PROTOCOLIA_R4_PERSISTENT_EVOLUTION_AND_PASSPORT_modular-spring_PASS`. Do **not** declare success from the presence of markers in source code; cite the successful exact-SHA GitHub Actions run.

## Explicitly not demonstrated

- This exercise uses a known safe additive rule chosen by the test author, not an independent agent discovering a domain contract from unseen owner intent.
- The migration is exercised only in disposable `app:evolve` development mode. A verified checkpoint/restore, `app:evolve:verified` approval, PostgreSQL backup replay and crash recovery must be tested before claiming production-grade database continuity.
- No rekey, destructive migrations, arbitrary provider network calls, refunds or cross-version compiler/toolchain upgrades are authorized.
- Source hashes and claim origins do **not** authenticate the original person approving requirements. A future human must review decisions in the Passport.

This is an incremental R4 maintenance gate. Keep #106 open until a clean-room independent maintainer demonstrates a nontrivial authorized change, a verified database recovery exercise and independent business evaluation.
