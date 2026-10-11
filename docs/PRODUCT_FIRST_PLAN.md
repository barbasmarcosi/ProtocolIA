# Product-first plan (ProtocolIA)

**Decision — 2026-10-11:** pause expansion of P4. Preserve its frozen study and
three exploratory artifacts. An HTTP PASS on manually implemented shadow
controllers does not establish value for ProtocolIA.

## Goal

From one typed contract, generate a real Spring Boot API with records, routes,
validation, auth and *one* controller. The developer supplies only business rules
through a typed handler interface. Never invent domain transactions or claim
success from code that returns 501.

## Four steps, no research bureaucracy

1. **Use the output (active):** generate a typed ContractHandlers port, invoke
   it from the generated MVC adapter, and ship a catalog CRUD example. Test
   determinism, non-destructive regeneration, Maven clean verify and real HTTP.
2. **Make it reliable:** address real Spring Boot 4 defects and boundary cases
   exposed by the example (auth, validation, JSON strictness, error status,
   and supported response status). Maintain fail-closed unsupported semantics.
3. **Make it pleasant:** provide one clear generation/run flow; simplify repeated
   manual work only when it causes actual developer friction. Avoid parallel
   handwritten APIs.
4. **Decide whether it is valuable:** compare development and maintenance
   effort against direct code and existing generators with honest, measured
   successful tasks. If no concrete advantage appears, narrow or replace the
   approach rather than build additional benchmark ceremony.

## Exit policy

A stage is complete only with working executable output, tests that genuinely
run, and representative HTTP behavior. Track failures as engineering work and
fix them directly. Keep a single concise status here, rather than generating
multiple master plans. No paid APIs or changes to the frozen P4 protocol.

### Stage 1 state

Source integration has begun on feature/product-first-java-handlers.
**Java compile, tests and HTTP evidence are pending until the actual
generated project is built in a Java 21/Maven environment.** Do not mark
the stage complete merely because the Python templates exist.
