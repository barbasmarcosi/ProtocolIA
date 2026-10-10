# P3-B2.2 — Cryptographic operator authentication for a read-only broker

**Scope:** provider-free but optional `cryptography` package; Ed25519 key ownership is cryptographically demonstrated. This is a local trusted-host library, **not** a deployed human login/SSO web service. The public-key registry must be independently maintained by the host; merely naming a `subject` is no longer adequate at the new gateway.

## Separation and authentication

The operator keeps an Ed25519 signing private key on their own device. A host-controlled registry stores the corresponding public key, subject, key ID, allowed resources and per-key revocation flag. The host is responsible for independently binding the physical human to the enrolled public key (ideally a hardware-backed key plus MFA). The model, sandbox and runner never receive the private key, host HMAC service key or writable registry.

Before an approval, the trusted host produces a canonical `v0.6` intent containing the complete v0.5 plan hash, host broker policy hash, immutable Docker request, Docker policy hash, input bytes SHA, tool fingerprint, operator/key IDs, host environment, single-use nonce and ≤300-second expiry. The operator signs domain-separated canonical JSON with Ed25519. `approve_signed` verifies the signature with the exact host-owned registered key and resource grants, checks all bound fields again, consumes the nonce in a durable SQLite receipt and only then issues the underlying HMAC approval. A revoked key, altered resource, modified plan, changed operator registry, forged signature or expired intent never reaches Docker.

`run_signed` repeats the signature, current registry, resource and receipt checks before each attempt or replay. It repeats after Docker returns, so a registry edit during a read denies result acceptance (it cannot undo the read). `revoke_signed` requires the original valid operator signature and the protected host HMAC key; key revocation in the registry also denies all future run/replay operations for the old key. This is not an OIDC/JWT flow; there is no claimed deployed interactive authentication UI.

## Host secret custody and file permissions

Host config (operator public registry) and HMAC signing key must be existing *absolute*, non-symlink, private `0600`-equivalent regular files owned by the executor's effective UID. The service key is exactly 32 random binary bytes. The system reads via `O_NOFOLLOW` and validates UID, permissions, hard-link count and size. The approval service must run under a dedicated restricted OS identity without exposing these file paths, keys or the Docker daemon socket to the model or the container. These checks are not a full OS sandbox nor protection from a compromised trusted host or privileged root.

**Key rotation:** add a new public key record then issue fresh approvals; mark the old key revoked in the registry. The registry digest is included in signed intent, so any enrollment, removal or revocation makes existing intents stale. Receipt nonce uniqueness prevents signature reuse for separate operations. A failed approval after nonce consumption remains denied; reissue a fresh nonce/request with explicit host authorization.

## Tests and restrictions

Unit CI on Python 3.11/3.13 checks legitimate signed approvals, attacker signatures, key mismatch, disabled key, changed policy/plan, expired intent, wrong environment, weak file permissions, symlinked HMAC key, registry rotation, duplicate nonces and operator-signed revocation. A real Docker CI uses an ephemeral operator key + private host HMAC key to prove end-to-end approval and read-only execution. ProtocolIA-Test supplies its own separate key and fixture.

**Not yet supported:** production human enrollment/SSO/MFA, web UI/HTTP broker isolation, externally writable/paid tools, cost reservation or provider reconciliation, privileged daemon trust verification, secret rotation across active distributed brokers, and multi-external-effect compensation. Existing lower-level `approve_plan` remains accessible to code that already has the trusted HMAC secret; only the protected operator gateway should receive it in deployment. Keep issue #4 open.
