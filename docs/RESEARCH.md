# Research program — tests that can falsify the idea

## Thesis

Contract-first generation may reduce repeated LLM reasoning and cost **per verified task** on tasks with recurring structure. It may harm performance on novel/ambiguous tasks, complex domain logic or mature codebases. The improvement is an empirical question.

## Prior art and differentiation

| Project | Useful lesson | ProtocolIA difference to validate |
| --- | --- | --- |
| [OpenAPI Generator](https://openapi-generator.tech/) | Model-driven client/server generation | Beyond the HTTP surface into typed effects and agent execution |
| [Smithy 2.0](https://smithy.io/2.0/spec/index.html) | Transport-independent models, projections, traits | Evaluate reuse instead of reinventing an IDL |
| [CUE](https://cuelang.org/docs/) | Constraint validation and unification | Candidate validation backend for more expressive constraints |
| [JHipster JDL](https://www.jhipster.tech/jdl/getting-started/) | Declarative application/entity scaffolding | Evidence-driven cross-framework generation and change management |
| [GitHub Spec Kit](https://github.com/github/spec-kit) | Agentic spec-first workflows and quality gates | IR with executable deterministic transformations, not only structured docs |
| [LLMCompiler](https://github.com/SqueezeAILab/LLMCompiler) | Tool DAG compilation and parallel execution | Artifact contracts, effects and verification integrated with DAGs |
| [DSPy](https://dspy.ai/) | Optimize model programs based on metrics | Optimize the combined model+compiler system, not prompts alone |

No originality claim is made merely by combining these ideas. Novelty must be in measurable composition, formal guarantees, portability, or reduced model work.

## Experimental protocol

Three arms, same held-out tasks and evaluation environment:

A. Direct coding agent baseline.
B. Agent plus ordinary templates/SDK generators, without ProtocolIA IR.
C. Agent generating ProtocolIA contracts + deterministic compiler + repairs.

Task strata: greenfield CRUD; APIs with domain invariants; brownfield changes; cross-service contract revisions; unsafe or ambiguous requests; non-repetitive algorithmic tasks. Prevent leakage between generated examples and the holdout set. Use multiple seeds/repetitions where sampling is nondeterministic, report confidence intervals, and retain failed executions.

**Primary outcome:** all-in USD per independently verified successful mission, together with success rate (no cost savings may mask materially worse correctness). Count model calls, input/output/cached tokens, tool/runtime costs, retries, testing time, and human interventions. Secondary: wall latency, patches changed after generation, security failures, ability to explain changes and artifact regeneration drift.

**Decision rule (proposed, not a measured result):** progress beyond experimental status only if C has a statistically credible cost-per-success reduction relative to BOTH A and B on the target repetitive strata, without a meaningful drop in correctness/security. Publish negative findings and cases where B beats C. Do not extrapolate from lines of boilerplate generated or isolated demos.

## Integration hypothesis

TrueMaestro, GastroApp and another independently selected project can become benchmark consumers, but ProtocolIA must not be tailored to one repository. TrueMaestro integration should start read-only / dry-run and not affect its provider cost controls or approval boundaries. Do not deploy generated server stubs as real business implementations.
