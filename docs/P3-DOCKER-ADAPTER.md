# P3-B1 — Scoped Docker adapter (experimental, read-only)

## Deliverable

This adapter proves one bounded external operation: computing SHA-256 for an explicitly approved input file. It is provider-free and does **not** expose arbitrary shell, Python, network tools, repository writes or user-supplied Docker flags.

The host supplies an absolute trusted input directory, a policy with an exact allowlist and zero USD spending, an already-pulled image pinned by local sha256 image ID, a separate pre-existing ledger directory, a host-declared subject (whose actual authentication must be performed by the host) and environment, plus a private 32+ byte approval secret. The plan controls only a versioned tool name, request ID and logical resource key.

A preview computes the input fingerprint without opening the approval ledger. Approval is explicitly issued by the host and HMAC-seals the request hash, policy hash, input hash, subject, environment, expiration and tool implementation fingerprint. Revocation verifies the same signing secret before modifying approval state. Revocation blocks results and replays. Never expose the approval secret or Docker daemon socket to any agent/model. **A real operator-authentication system is NOT implemented**: deployment must enforce that control outside this library.

## Boundaries

The trusted host reads its allowed file through directory-relative opens using O_NOFOLLOW and rejects traversal, symlinks, devices and oversized input. It stages a bounded copy to a disposable file and mounts only that copy into Docker read-only. The sandbox uses network none, read-only root, cap-drop ALL, no-new-privileges, unprivileged UID/GID, memory/PID/CPU limits, tmpfs, no image pulls and an immutable local image ID. This is a real process/container isolation boundary under a **trusted local Docker daemon**, not a guarantee against a kernel escape, compromised container image, privileged daemon/host, remote Docker context, image pull substitution or arbitrary additional host mounts by administrators.

An immutable request ID is claimed in a durable SQLite record before launching Docker. If a timeout, crash or ambiguous failure occurs, the attempt is quarantined; no automatic retry or duplicate side effect is allowed. Only successful exact replays use previously committed result evidence. A revoke during execution causes result refusal. Hard timeout kills the Docker client and attempts to forcibly remove the named container; a failed cleanup requires operator investigation, and is not proof that it was killed. Only known read-only operations are permitted, so no external write compensation is claimed.

Zero-cost is a verified constraint of this *fixed read-only local operation*: max_spend_usd must be integer 0. The adapter does not implement a paid-provider usage or reservation ledger and cannot authorize unknown-cost operations.

## Local operator usage

1. Preload and inspect a trusted Docker image; resolve its **local sha256 image ID**. Do not accept tags supplied by the agent.
2. Create a resource allowlist policy referencing that image ID and existing absolute host input/ledger directories.
3. Set PROTOCOLIA_SANDBOX_APPROVAL_SECRET in the **trusted host service**, never in a prompt or repository.
4. Run python -m protocolia.sandbox_cli preview, then approve (host-authenticated subject), then run; revoke by immutable request ID when needed.
5. Only the trusted service should have access to the approval interface, Docker daemon and secret. The user-facing model receives preview/results, not these privileged interfaces.

The CI tests a disposable Docker container and runs network, read-only filesystem, mount visibility, approval/revocation and replay probes. An independent consumer must additionally verify the same boundary on its own fixture.

## Remaining P3-B2

Actual privileged external writes, durable outbox and compensation, remote-provider accounting/reservations, tightly authenticated human approval brokerage, hardened image provenance and daemon trust, revocation-driven container termination and adversarial third-party sandbox escape evaluation remain outside P3-B1. Keep P3 issue #4 open.
