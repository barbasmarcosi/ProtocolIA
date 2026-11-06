# R4.3 live trial — fresh bounded model with file tools, independent assessor

**Status:** live-trial candidate; not a certified successful agent handoff until a complete exact-SHA GitHub Actions run demonstrates actual provider inference, tool calls, semantic scoring, both backend builds and any required database validations. A model authorization or quota failure is a failed/blocked experiment, not evidence that the model could not solve the problem.

## Why this is a step beyond the deterministic control

The previous [R4.3 evaluator](R4_COLD_HANDOFF.md) generates a verified participant-only bundle and tests six deliberately scripted submissions. That is scorer validation, not independent model competence.

This workflow invokes a **fresh external hosted model** through GitHub Models in a separate Actions job, never replaying or forwarding the conversation that designed ProtocolIA. The job performs **no repository checkout**, and its GitHub token is restricted to `models:read`, `actions:read` (for the handoff artifact) and `contents:none`. No personal API key is required. The external model request receives only the participant package's filename list, fingerprint, and content returned by narrowly scoped read-file tool calls.

The harness includes four bounded tools: `read_file` for exact verified names in the immutable handoff, `write_candidate` for only `contracts/main.tsp` or `handoff-response.json`, `check_candidate` for elementary syntax/diff feedback (not the hidden oracle), and `finish`. It has **no shell**, arbitrary file access, network or GitHub API tool. A maximum of 10 model calls controls cost. It records model ID, call count, token usage and tool names (no tokens, payloads, secrets or prior chats), and uploads the actual candidate and provenance metadata.

A **different Actions job** downloads that output and checks session completion and real tool usage; only that assessor job checks out the repository, sees the CI oracle and invokes `r4-handoff-benchmark.mjs score`. It also builds generated NestJS and modular Spring apps from **the actual model's TypeSpec**, validates the new field and verifies each generated app ownership seal. There is no substitution of the earlier deterministic reference control.

## Reproducible artifact and exact sequence

`.github/workflows/r4-independent-model-trial.yml`:

1. `prepare` generates source-bound Taller app and seals a participant-only package. It publishes `r4-live-participant-only` and a separately named executable runner script.
2. `independent-model` starts a **fresh GitHub Models chat** through `https://models.github.ai/inference/chat/completions`, using repository Actions' short-lived `GITHUB_TOKEN` and `models: read`. It never checks out the source repository or receives the oracle. It runs the limited four-tool interface and publishes `r4-live-model-response`, even after a model failure if metadata exists.
3. `assessor` inspects provenance, tests the real candidate against a separately loaded CI oracle and rebuilds the two actual backends from the submitted contract. If the agent cannot finish, the assessor is skipped; this must be reported as a trial failure.

The workflow is limited to a same-repository, specifically named feature branch for pull-request runs. This prevents arbitrary untrusted fork PRs from triggering inference with the built-in token. There is also an explicitly invoked `workflow_dispatch` route. No schedule, deployment or background monitoring is created.

## Remaining trust and product limitations

- The model **is independent of this chat context**, because the API request contains no previous chat and has only the provided source. It is nevertheless a model with a bounded tool loop, not an autonomous multi-hour software engineer; this is a limited coding-agent trial.
- The oracle is committed in the same private repository, and hidden from the provider model **by tool/API interface** and job separation, not because the repository is globally secret. This is a meaningful interface-isolated trial, but not independent model- or vendor-grade assurance against deliberate out-of-band repo access.
- Successful semantic scoring and dual generation alone do not prove **full populated PostgreSQL migration, real HTTP/browser acceptance, signed business authorization, multi-year maintainability, or future compiler portability**. These require a separate integration acceptance on the exact model output and a second unfamiliar domain/harness.
- A SHA-256 digest confirms byte-level integrity but does not authenticate owner approval. The use of Github Models may incur normal provider quotas or metered charges based on repository/account settings. Do not log or expose the built-in token.
- The model's tool transcript records tool **names and counts**, not full inputs. This is cost-conscious but insufficient for a forensic-grade provenance audit. Preserve a stronger private, reviewer-accessible transcript with no secrets in a later stage.
- No automatic retry on HTTP 403/429, no fallback to hand-authored solution, no deploy. If the account denies GitHub Models permissions or quotas, record the blocked result and retain the PR as draft. Keep [issue #106](https://github.com/barbasmarcosi/ProtocolIA/issues/106) open until the full acceptance gates have real evidence.

References: [GitHub Models in Actions](https://github.blog/ai-and-ml/generative-ai/automate-your-project-with-github-models-in-actions/) documents the repository `GITHUB_TOKEN` and `models:read` permission. `models.inference.ai.azure.com` is deprecated; use the current `models.github.ai` host.
