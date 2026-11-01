# R2 — Structured autonomous intake to TypeSpec, executable v0.1

**Status: experimental bounded draft compiler.** It is a building block for agent-assisted requirement discovery, NOT an LLM integration, general natural-language parser or complete kiosk application. Stacked above R3 and R1; canonical TypeSpec compiler and Spring/Nest adapters are unchanged.

## Motivation

Superpowers, Spec Kit, GSD Core or another harness may draft a machine-readable, editable requirements proposal. ProtocolIA checks that proposal, isolates unresolved features, and emits a normal TypeSpec project. TypeSpec remains the canonical executable semantic source after generation. A human may edit it, but the verifier then correctly detects divergence from the original proposed draft.

## Supported profile (explicitly limited)

One administrative entity with three typed fields: unique string identity, required bounded label string, nonnegative bounded integer count. Generated operations: create, get, paginated list, positive atomic increment and bounded label update; public health route. Read/write capabilities are server-declared.

No arbitrary business rules, tax, discounts, returns, payments, externally authenticated identities, migrations, complex UI or database authorizations are invented. Those requirements must remain visible as deferred rather than being declared complete.

## Example commands

    node scripts/research/intake-to-typespec.mjs generate research/autonomous-engineering/samples/kiosk-profile-draft.json /tmp/kiosk-contract
    node scripts/research/intake-to-typespec.mjs verify research/autonomous-engineering/samples/kiosk-profile-draft.json /tmp/kiosk-contract

For TypeSpec compilation, package resolution requires the pinned local node_modules. The CI generates temporary projects **inside the ProtocolIA workspace** and runs:

    npm run build:vnext
    ./node_modules/.bin/tsp compile <workspace-temporary-project>

Generated files:
- contracts/main.tsp and tspconfig.yaml: actual canonical TypeSpec project.
- requirements.json: declared requirement/operation links, not independently authenticated owner evidence.
- decisions.json: full unresolved/provisional questions with origin, proposed choice and references; all self-declared, never authenticated approval.
- protocolia-intake-report.json: partial status and deferred questions, including question text and source.
- protocolia-intake.lock.json: deterministic unsigned source/output hashes.

The verify command runs before TypeSpec generates tsp-output and rejects any edited or unknown output. Manual contract changes are expected, but they make draft verification fail intentionally: the edited TypeSpec revision must then be managed as a new authoritative contract, not overwritten from stale intake.

## Autonomous safety gates

1. Unknown fields, unsafe identifiers, unrecognized operation mappings, duplicate IDs and malformed bounds fail closed.
2. A deferred requirement cannot claim implemented operations. Agent assumptions cannot claim executable coverage.
3. Unresolved or material questions affecting the supported profile block generation. A material question isolated to deferred functionality stays visible in a PARTIAL_DRAFT_UNVERIFIED report.
4. Provisional questions are restricted to reversible technical choices. They never grant privileged actions.
5. Declared explicit_owner origins and evidenceRefs are NOT cryptographically authenticated or independently checked; even valid output is only DRAFT_UNVERIFIED, not customer-approved requirements or production authorization.
6. No LLM runs, external calls, deployment, payment processing, database writes or privileged modifications take place in the generator.

## CI

- Tests: node --test tests/research/intake-to-typespec.test.mjs
- Compile generated TypeSpec against the real ProtocolIA emitter, then generate and verify a linked Project Passport, including its decision-ledger page and source hashes.
- Generate a NestJS application and run ordinary conformance against disposable PostgreSQL if the job succeeds.

**Still open:** agent tool comparison, true autonomous clarification, third-party customer evidence, full kiosk functionality, independently measured effort reduction, and the complete two-year handoff. Keep research issue #106 open.
