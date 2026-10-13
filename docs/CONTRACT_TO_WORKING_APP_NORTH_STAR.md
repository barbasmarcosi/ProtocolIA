# ProtocolIA — Product North Star: contracts → working application

**Decision, 2026-10-13:** prioritize generating usable software from
well-defined contracts over measuring token savings or optimizing agent
benchmark costs. G0–G5 remain historically accepted within their narrow
pilot scopes. This document defines the **NEXT** goal, not a shipped feature.

## 1. Product promise

A user identifies requirements; a human and/or AI translates them to
**versioned, explicit ProtocolIA contracts**; the developer runs **one
generation/build workflow** and receives a **usable baseline application**,
not only DTOs, HTTP skeletons, 501 placeholders or an empty scaffold.

The resulting application should have, within the contract's supported
semantics:

- Database schema, constraints, migrations, durable CRUD and declared
  transactional mutations; an actual implemented backend (not 501).
- Versioned HTTP API, structured errors, validation and server-enforced
  authorization.
- Responsive navigable web UI: list/search or pagination, detail, create,
  edit, actions, empty/loading/invalid/error/permission states.
- Integrated generated typed client, invalidation, runtime configuration,
  runnable tests, local start and deployable container.
- Safe deterministic regeneration after a compatible contract change.

**The only user-maintained app-specific inputs for a supported base-system
profile should be the contracts and environment/deployment configuration.**
Custom complex behavior is an explicitly declared extension, never
silently guessed. Contracts are the product specification, not instructions
for a probabilistic code-writing agent to improvise missing business rules.

## 2. What the current software demonstrably does / does not do

G5 (PR #49) provides deterministic contract projection and guarded codegen
for HTTP/Java interfaces, Orval and basic contract-driven Forms. It verifies
a manually integrated Books v0.4 system but does **not** generate its
PostgreSQL domain implementation, migrations, auth configuration or React
screen layouts.

The independent workshop-tools demo, source branch
`experiments/p5-taller-real-requirements-v1`, is **LIVE** on Render with
PostgreSQL, CRUD-like actions, forms and authorization. It required
app-specific human-authored `ToolInventory.java`, `ToolsDelegate.java`,
Flyway SQL, `DemoSecurity.java`, React composition, Docker and scripts.
It used `compile-bundle` + OpenAPI Generator + Orval directly, not the
integrated `regenerate-fullstack` CLI. See
[`experiments/taller-requirements-v1/EVIDENCE.md`](../experiments/taller-requirements-v1/EVIDENCE.md)
**on its experiment branch**; this path is absent on `main` until merged.

**Critical gap:** operation `method/path/request/response/effects/capability`
describes an API boundary, **not** the data operation's exact semantic
intent. An arbitrary PATCH can mean assignment, increment, transition,
balance transfer, approval or something else. A deterministic compiler
must not invent one. The missing component is a declarative domain model
and operation semantics plus reusable backend/UI templates.

## 3. Target architecture

    requirements (outside ProtocolIA)
          |
          v
    existing contract.json + resources.json
             + NEW declarative domain/persistence/behavior description
          |
          v
    validate -> canonical IR -> compile -> assemble -> test -> deploy
                   |               |
        OpenAPI/JSON Schema     domain/persistence compiler
        capability/UI IR           |        |
                   |             SQL       real Java handlers
                   |               |        |
             Orval client ------- Spring Boot -------- PostgreSQL
                   |
          generic React resource renderer (manifest + RJSF)
                   |
          one configured, runnable app + generated test fixtures

Retain the existing G5 Java/Spring + Orval + React/RJSF toolchain as the
baseline. Build **missing semantics and a reusable application shell**,
rather than designing a new programming language, duplicating a mature
generator or asking an LLM to produce the same boilerplate repeatedly.

### Domain contract, initially narrow

Add a **separately versioned** domain description (e.g.
`domain.json`; proposed new schema, NOT yet supported by ProtocolIA).
Tie it to existing validated entity/request/response types, operation IDs
and resource roles. It should state explicitly:

- Entity identity, persistence fields, unique constraints, nullability,
  defaults and safe names; first-class relationships only when supported.
- Operation's actual behavior, selected from a bounded library:
  `create`, `get`, `listPage`, `patchFields`, `delete` and
  `atomicIncrement` with declared field/input/bounds/overflow handling.
- Transaction boundaries, expected affected-row cardinality, 404/409
  semantics, optimistic concurrency where relevant, authorization
  capability and list invalidations.
- UI view/field metadata and visibility; backend authorization is
  independent of UI visibility.

Illustrative *future schema proposal*, NOT a current executable contract:

```json
{
  "version": "0.1",
  "entities": {
    "tools": {
      "model": "Tool",
      "identityField": "code",
      "operations": {
        "createTool": {"kind": "create", "inputModel": "ToolRequest"},
        "getTool": {"kind": "get"},
        "listTools": {"kind": "listPage"},
        "renameTool": {
          "kind": "patchFields",
          "fields": {"name": "name"}
        },
        "increaseQuantity": {
          "kind": "atomicIncrement",
          "field": "quantity",
          "inputField": "amount",
          "maximum": 2147483647
        }
      }
    }
  }
}
```

This is a semantic projection of explicit intent. It is **not** an excuse
to infer behavior from endpoint names. Any incomplete, inconsistent,
unsupported, dangerous or ambiguous declaration must fail with an
actionable error **before** generating a misleading app.

### Ownership and migrations

Generate database DDL/migrations and Java application handlers into
owned trees. Preserve custom/user-owned extensions untouched. Initially
generate an empty-db Flyway baseline; migration of nonempty databases
requires explicit compatible-diff rules, additive migrations and
negative tests. Never silently drop columns/tables or run destructive
production migrations. Use parameterized SQL, verified identifiers,
PostgreSQL constraints and atomic updates; never concatenate arbitrary
contract text into SQL.

Make the UI a **generic shell** iterating declared resources instead of
copying or renaming `BooksScreen.tsx` to `ToolsScreen.tsx`. It must not
need changes per supported new resource.

## 4. Implementation milestones — build in order

### A1 — Generate the workshop's real backend automatically

Input = its existing contract + resource metadata + a new domain contract.
Output = Flyway baseline, typed Spring CRUD/atomic-increment handlers,
generated delegate bindings and capability-enforced dev security.
**Acceptance:** remove all app-specific human Java domain handlers and
Flyway SQL from the workshop build; same HTTP tests pass, including
duplicate code, null date, 400/401/403/404/409 and 10 simultaneous
increments with exact total. No hardcoded `Tool`/`Book` in the generator.

### A2 — Generic contract-driven React application

Generate/compose one resource registry, reusable list/detail/create/
edit/action screens, RJSF schema forms, typed Orval hooks, role-aware
navigation and cache invalidation. **Acceptance:** the workshop app runs
without `ToolsScreen`, handwritten tool-specific form/cache components
or copy/paste entity-specific labels in app code. Real browser test:
login, list, create, mutate, refresh, invalid data, viewer cannot write.

### A3 — One-command assembly and deployable starter

Expose a simple invocation consuming the bundle of contracts and
explicit local dev credentials/environment, e.g.
`protocolia app build ./contracts --out ./taller-app` (planned CLI,
**not implemented**). Produce backend/frontend, SQL, Dockerfile,
local dev compose/start scripts, sample config and executable smoke
tests. **Acceptance:** clean isolated checkout + contracts + pinned
toolchain -> working app and optional Render Free ephemeral DB profile;
rerun safely without handwritten patches. Record provenance of every
generated vs configured file.

### A4 — Unseen second domain, multiple resources

After A1–A3, use a **new independent contract** (not a renamed Book/Tool)
with two related entities, for instance `Equipment` and `Inspections`.
Support declared foreign key and per-resource capabilities in the
approved grammar. **Acceptance:** no new Java service, SQL migration,
React screen or API integration handwritten between authoring
the contracts and testing the generated application. Real PostgreSQL
and browser E2E; verify reference integrity, consistent pagination,
404/409, server-side permissions and compatible regeneration.

### A5 — Expand only where real requirements demand it

Add explicit declarative workflows/states, relationships, lookup widgets,
search/filter, audit fields, role policies and transactional multi-entity
behaviors as needed. Complex novel processes may use clearly documented
user-owned plugins until the contract language can express them safely.
Do not advertise universal automatic application generation on the basis
of a small CRUD grammar.

## 5. Definition of success and priority rules

**Primary measure:** completion of a supported contract into a usable,
functioning full-stack app **without writing or repairing application-
specific implementation code after the contracts are finalized.**

First milestone: **workshop tools generated end to end without manual
domain or screen code**. Stronger milestone: **unseen independent
two-entity app generated end to end**, with real database, auth and UI.

For a given versioned grammar:

1. **100% of declared supported operations** work against a real DB with
   documented behavior; no required operation returns 501.
2. The generated frontend can execute every declared supported view
   and operation, while server permissions still protect direct HTTP.
3. A clean deployment builds and serves UI + API without patching
   generated output or copying handwritten domain handlers.
4. Regeneration is reproducible and preserves extension points, with
   explicit rejection of incompatible/destructive changes.
5. Any unsupported operation reports its **precise missing semantic
   feature**; no partial fake success.
6. Evidence includes a simple real test case and a clean-room invocation.
   Spend test effort on breaking behavior, not repeated bureaucratic gates.

**Not the primary KPI:** LLM-token savings, cost of coding agents,
P4 economic benchmarks, raw line counts, number of PRs or number of
checks. P4's already frozen scientific artifacts may be retained, but
must not drive the A-series sequence or delay delivering a functional
contract-only app.

## 6. Execution rule

Prioritize implementing A1 → A2 → A3 on a new isolated feature branch,
using the workshop as the first realistic target. Keep its existing
public manual demo intact until replacement behavior is demonstrated.
Avoid adding speculative frameworks, speculative authorization flows or
general workflow engines. Progress means **less code required outside
the contracts to obtain the exact same application**, not more
documentation or polished scaffold screenshots.
