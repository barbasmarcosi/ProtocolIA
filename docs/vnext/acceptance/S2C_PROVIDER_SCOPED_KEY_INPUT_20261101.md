# S2c — operator-scoped provider and descriptor-bound pinned key (2026-11-01)

## Concrete risk and contract

The detached Ed25519 signature previously bound the provider name **only to the
signer's own metadata**. A key trusted for one operator-selected provider could
also validate a correctly signed statement labelled as another provider when
the same key was reused or the operator selected the wrong trust material.
The SPKI fingerprint pins cryptographic key bytes; it does **not** pin an
independent provider name. A separate, operator-supplied expected provider is
needed to prevent accidental provider-context substitution.

Every invocation using the detached signature flags now requires
`--expected-provider <provider-id>` alongside `--expected-order`, the
attestation, the public key and the out-of-band SPKI SHA-256 pin. The expected
provider must match the signed `providerId` and each external event's provider.
The flag is rejected in unsigned mode, so no unsigned report can imply a
trusted provider context. This is intentionally a fail-closed change to the
signed CLI interface; existing signed callers must supply the expected ID.
The key remains an operator-pinned key: this **does not independently verify**
the provider's real-world identity, bank settlement, account ownership or
statement completeness.

The pinned PEM loader also now reads the **same opened regular-file inode**
checked by `lstat`, using `O_NOFOLLOW | O_NONBLOCK`, a strict 8192-byte
limit, descriptor-based reads, before/after size and observable timestamp
checks, and fatal UTF-8 decoding. This refuses a symlink, inode substitution,
FIFO replacement, growth, invalid UTF-8 or observable concurrent rewrite.
The existing independent SHA-256 SPKI fingerprint is still required; path
validation alone is never a trust root.

## Reproducible acceptance

```sh
node --check packages/adapters/provider-statement-signature.mjs
node --check scripts/vnext/reconcile-provider-statement.mjs
node --test tests/vnext/provider-statement-signature.test.mjs \
  tests/vnext/provider-statement-local-replay.test.mjs \
  tests/vnext/provider-statement-event-replay.test.mjs
```

Positive: valid Ed25519 key and signed provider/order produce the same
non-authoritative comparison. Negative: valid *other-provider* signature
under the same key, missing or invalid expected provider, symlinked key,
pre-open inode substitution, inconsistent descriptor metadata and malformed
key bytes are rejected with exit 1/no financial JSON. Local event/statement
replay tests must still pass, including concurrent claims and fail-closed
interrupted state. The S2c workflow runs Node 22 and 24; independent generated
NestJS and Spring PostgreSQL/HTTP CI remain regression gates.

**Limitations:** no independent provider onboarding/identity proof, trusted
external settlement, distributed anti-replay, production tenant IAM/RLS,
refund execution, bank reconciliation journal, or disaster recovery. Issue #57
must stay open. No real-money processing, production deploy or stable tag.
