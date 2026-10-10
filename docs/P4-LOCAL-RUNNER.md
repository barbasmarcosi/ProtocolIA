# P4 — Local subscription CLI runner (Codex / Claude Code)

STATUS: local trial automation verified with **fake CLIs only**. No model sessions, cost claims or API keys.

The benchmark is designed for the user's already logged-in Codex or Claude Code subscription, not an API integration. GitHub Actions MUST NOT start real agents. The original A/B/C preregistration and independently owned tasks are documented in P4-SUBSCRIPTION-CLI.md.

## Installation and trust boundaries

Use a disposable VM or container with a dedicated unprivileged OS account, Java 21 and the pinned generator tools preinstalled. Run the Codex or Claude CLI with its existing subscription login. Never supply OPENAI_API_KEY, ANTHROPIC_API_KEY, CODEX_API_KEY or alternate provider billing variables. The runner refuses known key-bearing environment variables but cannot independently attest to every login mode or credential file.

Create these **existing, disjoint absolute folders**: /home/you/p4-work (candidate code), /home/you/p4-private (host-only prompts and traces), /home/you/p4-results (publish-once metrics). A separate clean ProtocolIA-Test checkout at immutable commit 77ec9150fed3b1ae4e80c87befc052e34702af8c must live OUTSIDE them. Its hidden-from-workspace HTTP grader must not be copied into a candidate workspace. The public GitHub grader is not cryptographically secret against a network-capable agent.

## 1. Freeze study and prepare one selected assignment

Run from the pinned ProtocolIA installation:

    python -m protocolia.p4_benchmark freeze benchmarks/p4/studies/codex-pilot.json /home/you/p4-private/codex.lock.json

Only freeze once, never overwrite its study hash. For Claude Code, freeze claude-pilot.json into its own lock instead.

Then, for a trial from the frozen set:

    python -m protocolia.p4_local_runner prepare --lock /home/you/p4-private/codex.lock.json --run-id codex-catalog-crud-r01-direct --fixtures /home/you/ProtocolIA-Test --runs-root /home/you/p4-work --evidence-root /home/you/p4-private/traces

This checks the fixture Git HEAD and exact original task SHA256, writes only TASK.json and an initialized Git repo in a new worktree, and stores prompt.txt and prepared.json in the separate private evidence tree. The task, prompt and action arm are hashed so they cannot be quietly modified before execution. An existing attempt ID cannot be reused.

## 2. Explicitly launch one real logged-in session

This is the ONLY action that uses a Codex/Claude session quota, and demands an explicit --execute flag plus --model:

    python -m protocolia.p4_local_runner run --lock /home/you/p4-private/codex.lock.json --run-id codex-catalog-crud-r01-direct --runs-root /home/you/p4-work --evidence-root /home/you/p4-private/traces --model YOUR_PINNED_CODEX_MODEL --execute

For Claude, use the Claude lock and a claude-... run ID with YOUR_PINNED_CLAUDE_MODEL. Do NOT use dangerous permission bypasses or grant extra workspaces. Codex runs in workspace-write with approvals disabled on a throwaway workspace; Claude uses print mode, JSON output, session persistence disabled and acceptEdits (which is NOT kernel isolation). Separate OS/VM sandboxing remains the operator's responsibility.

The host records CLI version, pinned requested model, process exit code, monotonic wall time, timeout/cancellation evidence, trace SHA and observable token counts. The raw agent response is kept private and never committed. Timeout kills the process group; after a started.json claim, the same attempt can never be automatically re-executed. A CLI result is NOT proof of task success.

## 3. Independent grader after the agent stops

Start generated Java code **only in a separate disposable sandbox** that makes its HTTP endpoint reachable locally on 127.0.0.1:8765. Never run untrusted generated Java with host credentials. The runner deliberately does NOT launch a JAR.

Evaluate and record one attempt:

    python -m protocolia.p4_trial_finalize --lock /home/you/p4-private/codex.lock.json --run-id codex-catalog-crud-r01-direct --runs-root /home/you/p4-work --evidence-root /home/you/p4-private/traces --results-root /home/you/p4-results --verifier-checkout /home/you/ProtocolIA-Test --base-url http://127.0.0.1:8765 --interventions 0 --repairs 0

Finalization requires the verifier checkout at the EXACT pinned commit with no dirty or untracked files, and independently calls its randomized HTTP acceptance checks. A proper failing verdict counts as a **failure**, including inaccessible or incomplete services. If the verifier itself crashes before producing evidence, this is unverified, not a falsified pass. Results are one-shot, immutable by default and retain token/cost UNKNOWN where unobservable.

## 4. Report without cherry-picking

    python -m protocolia.p4_benchmark report /home/you/p4-private/codex.lock.json /home/you/p4-results

The pilot schedules 36 attempts per subscribed CLI: A direct, B conventional generator, C ProtocolIA, each for four tasks and three repetitions. Choose Codex OR Claude depending on your existing subscription. Missing trials, model switches, tool availability differences, denial of tools and manual repairs must be published, not omitted. Never treat Claude API-equivalent USD as real subscription billing, never fabricate incremental dollars and never claim a winner from the CI simulation.

## Remaining P4 limitations

The local runner is a thin coordinator, NOT a hard security sandbox, an automatic end-to-end JVM server launcher, a billing monitor or a tamper-proof verifier. Separate user/VM isolation and a clean grader checkout are required for credible measurements. Actual logged-in runs, their correct/incorrect outcomes and wider brownfield/nonrepetitive benchmark strata remain to be performed. P4 issue #5 stays OPEN.
