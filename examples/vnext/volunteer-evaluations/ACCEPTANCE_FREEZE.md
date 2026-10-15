# Independent benchmark — immutable requirements freeze (before code generation)

**Origin:** user-provided `Taller III PSC.docx`, three pages, student-led external community-service requirements about monthly evaluation of volunteer personnel. Original document and its identifiable names, IDs, photographs and sample roster MUST NOT be committed or reproduced. This is an independent user-domain source, not the ProtocolIA examples or facility maintenance A13 contract. The data used for runs must be fictitious.

**Rule:** preserve all requirements below and evaluate them whether or not ProtocolIA currently supports them. Never call a form field for a total equivalent to an automatically calculated total. Ambiguities are NOT permission to invent rules. No goalpost-moving: revisions require a new frozen version and independent before/after score.

| ID | Frozen external requirement | Acceptance oracle | Initial support diagnosis (not a result) |
| --- | --- | --- | --- |
| BV-01 | Administrator, guard chief and personnel have distinct access rights | Admin can manage; chief edits only own guard/current month; personnel sees only permitted marks | **PARTIAL**: independent read/write capabilities; no production IAM or row/guard-scope |
| BV-02 | Create, edit and read personnel with guard/section changes | Valid FK changes preserved and audited; rejects invalid guard | **PARTIAL**: create/list/get; guard CAS reassignment; other edits not generated |
| BV-03 | Monthly person evaluation and historical lookup in a tabular UI | Two months remain independently queryable and printable | **PARTIAL**: persisted records, filtering/UI; file export missing |
| BV-04 | Accidental-service attendance 0–25 per month | 25 accepts; 26 and negatives reject | **SUPPORTED_CANDIDATE** |
| BV-05 | Mandatory attendance 0–35 per month | 35 accepts; 36 and negatives reject | **SUPPORTED_CANDIDATE** |
| BV-06 | Guard service 0–20 and internal order 0–20 | 20 accepts, 21 rejects for each | **SUPPORTED_CANDIDATE** |
| BV-07 | Aide/guard chief/section chief each enters authorized component | Unauthorized actor cannot write component | **UNSUPPORTED**: no per-field capability/ownership assignment |
| BV-08 | Monthly composite score generated, not manually entered | Stored result equals formula for inputs and adjustments | **UNSUPPORTED**: cross-field computed score not available |
| BV-09 | Annual leave: up to 30 continuous days or two splits, full-month previous-six-month mean, proportional partial month | Given six historical months, computed amount and split restriction exactly match the rule | **UNSUPPORTED**: historical aggregation and split constraint |
| BV-10 | Medical leave: full month 50; partial 1.67/day; service accident 100 | e.g. 10 medical days = 16.7; service accident = 100 | **UNSUPPORTED**: decimal calculations and exclusive branch rules |
| BV-11 | Extraordinary leave contributes no points | Exception excluded from score with no double count | **UNSUPPORTED**: scoring rule |
| BV-12 | Other score is entered by Aide based on chief's decision | Audit records authorized positive/zero adjustments | **PARTIAL**: numeric field and creation audit; no per-field role restrictions |
| BV-13 | Authorized corrections, template updates and previous-month review | Corrected score maintains history; templates editable by admin | **UNSUPPORTED**: score-specific update/template engine |
| BV-14 | View breakdowns per evaluation section and download score table | Drilldown and downloaded table match stored evaluations | **PARTIAL**: entity views exist; drilldowns/export not proven |
| BV-15 | Create/manage user identities and passwords | Provision user with protected roles and unique identity | **UNSUPPORTED**: only opt-in demonstration auth; no production user management |
| BV-16 | Provide a simple UI, persistent data and reliable history | Mobile/desktop real browser, HTTP, PostgreSQL restart, guard FK and immutable published evaluation | **PARTIAL**: needs empirical E2E and usability check |

**Source ambiguities requiring stakeholder clarification, not fabricated values:** identity/uniqueness of person-per-month; leap/month-length and partial leave denominator; leave point interactions with attendance and other points; whether 100 is a monthly ceiling or not; precision/rounding for historical averages; when months lock and can be corrected; which Aide/section-chief accounts have edit authority; guard/section moves effective dates. A `period` text field currently enforces length 7, NOT a semantic calendar date or uniqueness across volunteers. Leave-record `leaveKind` is an unvalidated string until supported enum rules exist.

**Measurement:** total 16 frozen requirements; classify verified PASS only after an independent runtime/HTTP/PG/browser test; distinct `PARTIAL`, `UNSUPPORTED`, `NOT RUN`, `FAIL` retained. Two backend targets are not a substitute for a requirement. No manually written entity-specific SQL, generated-app controller or UI patch is allowed to boost the score.
