# P4 nested Codex CLI execution — 2026-10-11 UTC

## Result

A second attempt to reach the empirical P4 run path used ProtocolIA main `2a7e1e0ce45375d445d030119dcd02af25936942` and the corrected runner. It prepared the first frozen assignment, `codex-catalog-crud-r01-conventional`, using ProtocolIA-Test detached at `77ec9150fed3b1ae4e80c87befc052e34702af8c`. The study digest remains `680037ab74cd4520243b8a8926402b317ae8cb7e2c2dbb84f5952b00cef14ab8`.

The runner invoked `/opt/codex/bin/codex` 0.159.2 with ChatGPT login, model request `gpt-6.1-sol`, default catalog reasoning effort `low`, workspace-write sandbox, ordinary approvals disabled and a 2400-second ceiling. Its parser preflight passed. The process exited 1 after 7.587 seconds, emitted no JSONL trace and wrote no candidate source files.

This is **INVALID_ENVIRONMENT_BEFORE_MODEL_TURN**, not an arm result: Codex failed before an app-server client could initialize because the active nested Work sandbox exposes `/root/.codex/state_5.sqlite` read-only. The recorded stderr says `failed to initialize in-process app-server client: Read-only file system`. The runner preserves `started.json` and refuses automatic reuse. There is no Java process or candidate artifact to grade, so the independent HTTP verifier was deliberately not run.

## Study status

| Quantity | Count |
| --- | ---: |
| Scheduled Codex sessions | 36 |
| Prepared catalog r01 workspaces | 1 |
| CLI processes invoked | 1 |
| Observed model turns | 0 |
| Candidate backends built | 0 |
| Independent HTTP verdicts | 0 |
| Comparable A/B/C results | 0 |

The failed nested invocation must remain in provenance, but it cannot be classified as a conventional-generator task failure or be used for timing, tokens, repairs or success-rate analysis. C and A were not launched because they would exercise the same failed session-initialization path.

## Valid continuation

Run the frozen B/C/A trio from an independent normal host already logged into Codex, where the CLI can write its own state and Java 21/Maven are available, or use three fresh top-level Codex sessions in frozen order while retaining their artifacts. Keep the frozen task, model, effort, permissions, time ceiling and treatment tools identical. A new manually coordinated run must explicitly link to this invalid nested process rather than silently overwriting its run ID.

The sanitized process evidence is [codex-catalog-crud-r01-conventional.json](../benchmarks/p4/evidence/20261011-nested-cli/codex-catalog-crud-r01-conventional.json). Raw stdout/stderr and prompt remain private and are not committed.
