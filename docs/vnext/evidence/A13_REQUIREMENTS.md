# A13 — Blind product acceptance: maintenance of distributed facilities

**Status:** frozen test brief, written before any A13 generation. **Date:** 2026-10-14.

## Independent customer brief

A small operator maintains machinery in multiple commercial premises. A dispatcher registers sites and their physical machines, records service technicians, opens service tickets on a specific machine with a responsible technician, schedules and closes them, and reviews who authorized changes. Readers need visibility but may not mutate anything; privileged staff need historical audit evidence. People need a mobile-friendly web app. Historical data must survive an application restart.

This brief is **not** a copy of Tool, Equipment/Inspection, WorkOrder, or stock reservation tests. It contains four related resources and a graph with two independent FKs on a single Ticket plus a second-level Machine→Site FK. We will not patch ProtocolIA generator, server templates or React for A13 after freezing the input contract. Unmet functionality is a product gap, not a reason to modify the test.

## Contract-first requirements and independently observable scoring

The following are **16 customer requirements**. Passing unit tests or emitted code does not count: demand actual HTTP/PostgreSQL/Chromium behavior.

| ID | Customer requirement | Grounded acceptance |
| --- | --- | --- |
| C01 | Register sites, with unique business code and validated names | POST/GET/list, duplicate 409, empty name 400 |
| C02 | Associate machines with a specific site | Real FK, orphan 400, site deletion restricted while referenced |
| C03 | Maintain a technician directory | Create, duplicate reject, list and GET |
| C04 | Ticket references exactly one real machine and one real technician | Two independent FKs, invalid reference rejects without creating row |
| C05 | Ticket contains title, severity and optional deadline | Store/retrieve text and optional UTC timestamp without field corruption |
| C06 | Ticket workflow reported → planned → completed | Only declared actions 200; impossible/repeated actions 409; bad initial state 400 |
| C07 | Concurrent dispatch attempts never both win | Ten simultaneous reported→planned operations: one 200, nine 409 |
| C08 | Dispatcher changes are audited and filterable per ticket | Field-level before/after and authenticated actor, no writes on failed operations |
| C09 | Read-only users can consult sites, machines, technicians and tickets, but not write | 401 unauthenticated, 403 reader on writes |
| C10 | Audit requires a distinct capability | 401 anonymous, 403 reader and authorized manager sees own ticket events |
| C11 | Mobile UI creates a machine via site picker and a ticket via TWO relationship pickers | Chromium 390×844, no manual UI source edits |
| C12 | Mobile UI operates ticket transitions and displays audit | Chromium actual clicks, reader does not see protected actions |
| C13 | Data persists through a server restart on the same PostgreSQL database | All resource rows, states and audit events preserved |
| C14 | Dispatcher can assign/reassign a technician AFTER filing a ticket | Dynamic reference update with validation, authorization and audit |
| C15 | Dispatcher can search/filter tickets by site, state and due date | Server filtering with accurate pagination; cross-site view |
| C16 | Overdue work alerts appear and trigger a notification | Declared due dates, time-aware alert and delivery mechanism |

**Do not change these requirements to manufacture a higher score.** C14–C16 may be unsupportable in the current declarative grammar. If the generator cannot express them, classify **UNSUPPORTED**, not PASS or a manual workaround. Additional independent hardening (rate limits, SSO/OIDC, encrypted backups, tenancy isolation, reports) is not included in the 16 score and remains product work.

## Isolation and rules

1. The contract under `examples/vnext/facility-maintenance/contracts/main.tsp` is **frozen before the generation/build**; preserve its blob hash and source SHA. Only trivial syntax corrections prior to freeze are allowed.
2. After freeze, prohibit generator/template, generated Java/TS/SQL/React, or A13 contract edits. A13 test scripts may be fixed only to correct **test-harness defects**, while recording them honestly.
3. Generate independently for `modular-spring` and `nestjs` from the exact same contract and compare canonical IR/OpenAPI SHA digests. Deploy/test actual generated artifacts, not handwritten substitutes.
4. Evaluate each C01–C16 from observed HTTP/PostgreSQL/browser evidence; distinguish available untested, unsupported, failed, and passed. Tests should catch duplicate IDs, missing FKs, concurrency conflicts, authorization, journal and restart.
5. The existing Render Free service is a *build marker*, **not** a public generated maintenance app. Count real-user persistent deployment as a distinct **deployment gate**, only PASS with an actually hosted accessible generated app and durable storage. No production claims from ephemeral build databases.
6. Do not touch `main`, earlier experiments, historical baselines or other repositories. No paid APIs and no GitHub Actions. The PR's current vNext generator SHA is the baseline to hold constant.

## Deliverables

- Frozen independent requirements, contracts and SHA evidence.
- Two unmodified generated Spring and Nest systems, HTTP/DB/Chromium probe logs.
- 16-row honest scored product acceptance and prioritized capability gaps.
- Separate *persistent externally usable demo* status, not conflated with Docker build.
