# P3 — Contract-to-action IR and scoped executor

This action plan language is **separate from API operations**. Version 0.4 has a closed vocabulary of tools: literal, sha256, assert.eq, kv.read and kv.put. There are NO model callbacks, shell commands, network tools or arbitrary Python evaluations.

The host supplies a trusted policy with exact capability grants and resource names. Plan capability labels do not grant authority: the validator requires the only capability/effects permitted for a tool, and the runtime independently authorizes every action and key. Conflicting effects on the same resource must be dependency ordered; execution is intentionally serial. No unsupported parallel scheduler is claimed.

The executor runs a plan in one SQLite transaction in a host-provided existing directory. It validates every action and entire budget before beginning side effects; commits results, journal events and key snapshots atomically. Same plan_id replay skips all actions **only** when normalized plan, policy, environment and event/snapshot hashes match. Changes invalidate replay. Rollback occurs on failed postconditions, cancellation and deadlines. Timeouts are cooperative and bound only this closed local operation set; they do NOT preempt external tools or processes.

Dry run validates the DAG, resource grants and budgets without touching the database. A single declared write reservation cannot be double-charged because the plan either commits once or rolls back, but this is not a general money/token billing system. No retries of external effects exist.

Reference data integrity is SHA-256 only: a privileged actor who can rewrite the SQLite database and all digests is outside the threat model. The workspace path, policy, cancellation signal, environment ID and clock are trusted caller inputs; hostile paths and symlinks are rejected, but Python/SQLite do not provide OS-level sandboxing or race-free protection against a concurrently privileged attacker. For real external tools P3 must add an out-of-process sandbox and capability revocation. Do not interpret passive declarations as security in an arbitrary execution environment.

Try provider-free:
    protocolia action-preview examples/action-plan-v0.4.json --policy examples/action-policy-v0.4.json
    protocolia action-run examples/action-plan-v0.4.json --policy examples/action-policy-v0.4.json --out /tmp/known-existing-workspace --environment demo-local-1

Only use empty/approved host workspaces. The plan cannot select filesystem paths. The sample policy is for disposable demo use; not a production authorization authority.
