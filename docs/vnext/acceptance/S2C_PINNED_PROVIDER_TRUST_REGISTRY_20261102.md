# S2c — optional pinned provider key enrollment (2026-11-02)

## Risk and scope

A detached Ed25519 signature proves only that the supplied public key signed the
supplied bytes. Previously the CLI could accept an operator-pinned key and an
expected provider independently, without a separate provider-to-key enrollment
record. An accidental key swap, wrong keyId or unreviewed rotation could make
a locally signed statement look consistent. This is **not** proof of legal
provider identity or of bank-cleared money.

## New optional gate

With the existing complete detached provider-signature flags, callers may
supply **both** flags:

    --provider-trust-registry registry.json --trusted-registry-sha256 SHA256

The SHA-256 is of the **exact registry file bytes** and must be retained by
the operator independently of the file and CLI arguments. The JSON is a
bounded, strictly parsed, descriptor-bound snapshot:

~~~json
{
  "version": 1,
  "providers": [{
    "providerId": "sandbox",
    "keys": [{
      "keyId": "key-1",
      "spkiSha256": "<64-lowercase-hex-sha256-of-ed25519-spki-der>",
      "status": "active",
      "validFrom": "2025-01-01T00:00:00Z",
      "validUntil": "2028-01-01T00:00:00Z"
    }]
  }]
}
~~~

A registry has 1–32 providers and 1–32 keys per provider. Extra or missing
fields, duplicate providers, duplicate keyIds, repeated SPKI fingerprints
within or across providers, malformed times and revoked keys are rejected,
including problems in unrelated entries. The selected provider, signed
attestation keyId and **actual verified SPKI fingerprint** must agree with the
registry; its active key interval must cover the entire signed statement
validity window and the inspection time. No implicit fallback to another key
or provider is permitted.

The registry file uses the existing strict bounded JSON loader (duplicate
decoded JSON keys and symlinks rejected). Its exact digest must match the
independently supplied pin. The original file is re-read during the final
cross-file freshness check **before any replay marker is consumed**. An
invalid or changed registry returns exit 1, no report and no replay mutation.
With a valid enrollment, the signed comparison and existing single-host replay
semantics remain unchanged. The optional result is
externalStatementSignature.providerRegistryBinding, with
trustScope=operator_pinned_registry_only, providerIdentityVerified=false
and settlementVerified=false.

The opt-in is backward compatible: without these two flags, previous
signature/replay behavior is unchanged. This does not auto-enroll, rotate,
revoke, fetch or independently authenticate keys. A caller controlling both
the registry and its alleged pin can forge an enrollment; offline pin custody
and authentic provider onboarding remain external responsibilities. Revoking a
key requires an updated, independently reviewed registry pin. No live
payments, actual refunds or chargebacks, production IAM, tenant isolation or
distributed replay is claimed.

## Verification

~~~sh
node --check packages/adapters/provider-statement-trust-registry.mjs
node --check scripts/vnext/reconcile-provider-statement.mjs
node --test tests/vnext/provider-statement-trust-registry.test.mjs
node --test tests/vnext/provider-statement-event-replay.test.mjs
~~~

The S2c Node 22/24 CI also runs the complete offline comparison suite.
Generated NestJS/Spring PostgreSQL/HTTP/rollback workflows and quality are
required before merge. This increment does not change either generator,
database schema or financial state. TL-14 #57 remains open.
