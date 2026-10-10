# Security posture and threat model

ProtocolIA contracts are untrusted inputs. Future agent outputs and generator extensions are also untrusted. The relevant assets are source repositories, developer secrets, filesystem integrity, credentials, deployment environments, correctness evidence and execution budgets.

## v0.1 boundaries

- Pure compilation and local file generation only. No shell execution, network access, package installation, model access, plugins or untrusted template evaluation in the library.
- Unknown fields and versions are rejected. Identifiers/types/path grammar are narrow and bounded. Writes with GET or public capability are rejected as basic static diagnostics.
- Output filenames are fixed; generated files are protected by SHA-256 comparisons against the previous manifest. Unmanaged existing files and symlinked output directories/files are rejected.
- Hashes and declared effects are **not** proofs of trust, correct authorization or execution behavior. A malicious editor can forge an unkeyed manifest. Filesystem adversaries with concurrent access may exploit TOCTOU races; do not run as privileged user against attacker-controlled paths.
- OpenAPI `security` declarations tell service generators which authentication mechanism is expected; generated OpenAPI does **not** enforce runtime authorization, transactional consistency or network hardening.
- Dependency graphs express declared ordering, not causality proven from real business behavior.

## Future boundaries before executing anything

- Runtime operations require separately granted capabilities (least privilege), explicit scopes, budgets and immutable logs.
- No free-form shell, SQL or remote code in contracts. Extensions require allowlisted, versioned implementations and isolated processes.
- Dataflow is tainted until validated; treat web/tool output as data rather than instructions.
- Separate proposer (LLM), policy enforcement, executor and independent verification; neither proposer nor generated code can approve itself.
- Sandbox plugins and generators against file traversal, symlinks and secrets; pin dependencies and record provenance.
- Reject nondeterministic execution replay unless effects/idempotency contracts and evidence are present.

## Reporting

Open an issue with a minimal reproduction that excludes credentials and private data. Do not publish exploit details involving real third-party systems or secrets.
