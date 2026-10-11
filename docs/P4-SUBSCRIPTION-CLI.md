# P4 — Codex and Claude Code subscription benchmark

STATUS: PILOT INFRASTRUCTURE / NO MODEL EXPERIMENTS RUN YET.

The intended agent is the already-authenticated Codex CLI using an existing ChatGPT plan, or Claude Code CLI using the user's own Claude plan. No provider SDK, API keys, credits or extra billing service is required for ProtocolIA. The benchmark itself NEVER logs in on behalf of the user and CI does not launch models.

Official sources:
- Codex with ChatGPT subscriptions: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- Codex CLI reference: https://learn.chatgpt.com/docs/cli/reference
- Claude Code CLI reference: https://docs.anthropic.com/en/docs/claude-code/cli-usage

## Experimental arms

A DIRECT: an agent implements the task directly, with neither ProtocolIA nor OpenAPI Generator.

B CONVENTIONAL: the same agent uses conventional templates and pinned OpenAPI Generator 7.20.0 when applicable, but cannot use ProtocolIA.

C PROTOCOLIA: the same agent compiles/generates from the pinned ProtocolIA core, then implements required unsupported semantics itself. Generic Spring endpoints that return HTTP 501 DO NOT count as completed domain behavior.

The task, independent HTTP verifier, Java 21/Spring Boot target, CLI model/version/effort, privileges, sandbox, human interventions and time budgets must be the SAME across arms within an engine. Every trial uses a fresh clean worktree without visibility into acceptance tests or earlier arms' changes. Model tuning or helping an arm based on previous private test failures counts as contamination.

## Frozen pilot

Study files:
- benchmarks/p4/studies/codex-pilot.json
- benchmarks/p4/studies/claude-pilot.json

Each freezes 4 distinct consumer-owned tasks x 3 arms x 3 repetitions = 36 sessions per CLI. Evaluate Codex and Claude SEPARATELY. No requirement to own both subscriptions to run one study. Tasks and evaluator are pinned to ProtocolIA-Test commit 77ec9150fed3b1ae4e80c87befc052e34702af8c and task-file SHA256 values; the CI independently verifies every checksum against that Git commit.

Pilot strata: greenfield CRUD, domain invariants and concurrency, HTTP contract evolution, hostile JSON inputs. P4 still needs broader true brownfield change tasks, algorithmic workloads, ambiguous requirements and representative larger samples before a strong conclusion. These tasks are in public version control, so the operator MUST keep the independent verifier outside the model-accessible working directory; public source cannot promise cryptographic test secrecy.

## Run on your own logged-in computer

1. Install and log in normally to Codex CLI with ChatGPT or to Claude Code with your existing Claude plan. No API key export. Record exact CLI version/model and do not switch them within a study.
2. Keep the task worktree, grader checkout, trace and results in SEPARATE local directories. Never give a model the grader files.
3. From ProtocolIA, freeze the selected checked-in study ONCE. For Codex, example:

    python -m protocolia.p4_benchmark freeze benchmarks/p4/studies/codex-pilot.json /private/p4/codex.lock.json

   Substitute claude-pilot.json for Claude. Freeze refuses overwrites.
4. Retrieve a planned packet:

    python -m protocolia.p4_benchmark packet /private/p4/codex.lock.json codex-catalog-crud-r01-direct

   Supply the packet plus the exact task specification from the pinned consumer commit to a fresh clean Java worktree.
5. Run the authenticated CLI with its ordinary permission system. For local noninteractive sessions, current examples are:

    codex exec --json --sandbox workspace-write - < prompt.txt > private-codex-trace.jsonl

    claude -p --output-format json "$(cat prompt.txt)" > private-claude-trace.json

   Confirm the flags with the installed CLI version. Do not use danger-mode permission bypasses; do not run in the verifier checkout. Limit resource access and record manual approvals/repairs and all elapsed time.
6. Start the candidate's Java service on a disposable localhost port. From a separate, pinned ProtocolIA-Test verifier checkout, run:

    python tools/p4_verify.py --task catalog-crud --base-url http://127.0.0.1:8765 --verifier-commit 77ec9150fed3b1ae4e80c87befc052e34702af8c --out /private/p4/verdict.json

   A failing service still produces FAIL evidence; do not quietly drop its trial. The verifier uses localhost only, not production.
7. Import the measured CLI and independent verifier results; do not commit raw agent conversations:

    python -m protocolia.p4_benchmark record /private/p4/codex.lock.json codex-catalog-crud-r01-direct /private/p4/verdict.json /private/p4/results/codex-catalog-crud-r01-direct.json --engine-version "codex X" --model "model-version" --seconds 582 --exit-code 0 --interventions 0 --repairs 1 --trace private-codex-trace.jsonl

   Missing tokens are explicitly NULL, not zero. An output record contains usage counts and a SHA256 of the transcript, NOT raw messages. Record refuses overwrites.
8. When ALL planned tasks have been attempted, report:

    python -m protocolia.p4_benchmark report /private/p4/codex.lock.json /private/p4/results/

   Scorecards include all scheduled/missing/failed sessions, 95% Wilson intervals for observed success, timing per success and only fully observed token totals. No winner is automatically declared. Independent review, matched task and model-stratum analysis, and publication of negative outcomes are required.

## Why not API cost?

Subscription plans use quota/limits rather than charging a reliable incremental provider-USD amount for each agent session. A Codex turn JSON stream may expose token counts; Claude Code JSON sometimes reports token usage and total_cost_usd, but this is not a verified subscription invoice. The benchmark stores that value only as api_equivalent_usd_not_billed and ALWAYS keeps actual_subscription_usd = null. No made-up dollars or price table multiplication.

Pre-registered primary outcome: independent verified success per arm. Secondary: real elapsed wall seconds per successful task and observed CLI tokens only if available and comparable. Include failures and interventions, do not cherry-pick and do not infer dollar savings. Repetitions are pilots, not proof of a universal 20% gain.

## Current limits and no-go claims

Neither Codex nor Claude is installed and authenticated in the repo's GitHub Actions: CI proves only the provider-free preregistration and scorekeeping code. The externally supplied verdict JSON has a pinned commit and evidence SHA but is NOT cryptographically signed, and the HTTP verifier tests defined behavior, NOT arbitrary JVM malware or secure Docker isolation. The completion of a coding mission will require recorded real subscription sessions and separately reviewed acceptance evidence. Keep P4 issue #5 OPEN until empirical results exist.

## Empirical execution preflight — 2026-10-11

36 scheduled, 3 catalog-crud workspaces prepared, **0 real sessions and 0 independent candidate verdicts**. Codex 0.159.2 reports ChatGPT login. Global approval flag placement corrected after real parser rejection. Restricted disposable agent/JVM execution remains unverified in this environment; Java 21/Maven/treatment tools also need provisioning. No empirical improvement claim. See [audit and reproduction procedure](P4-EMPIRICAL-AUDIT-20261011.md) and [machine-readable evidence](../benchmarks/p4/evidence/20261011-preflight/preflight.json). P4 remains OPEN.
