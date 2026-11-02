# S2c — operator-signed binding of offline financial snapshots (2026-11-02)

## Threat model

The optional provider Ed25519 signature verifies only the provider's *external*
JSON bytes relative to a manually pinned public key. Its signature DOES NOT
cover the operator-provided internal receipt export, reviewed receipt/transaction
crosswalk or separately recorded refund/chargeback journal. Even with an intact
provider signature, an operator could accidentally compare it with a different
batch, stale links or altered receipts. File-descriptor freshness checks protect
against observable local rewrites **during one invocation**, not against a
preexisting mixture of valid but unrelated source files.

## Opt-in feature (independent operator authority)

An independently pinned **operator** Ed25519 signature now binds the exact
SHA-256 bytes of all four financial inputs (or an explicit null sentinel when
`internalReturns` was NOT supplied) with the expected order, currency, scale,
and a bounded validity window. The operator signature and provider signature,
if supplied, are verified separately. Neither may establish bank clearing.

The operator signs a JSON manifest with exactly these fields:

```json
{
  "version": 1,
  "orderId": "O1",
  "currency": "ARS",
  "scale": 2,
  "internalSha256": "<sha256-of-original-internal-json-bytes>",
  "internalReturnsSha256": null,
  "linksSha256": "<sha256-of-original-links-json-bytes>",
  "externalSha256": "<sha256-of-original-external-json-bytes>",
  "validFrom": "2026-11-02T03:00:00Z",
  "validUntil": "2026-11-02T04:00:00Z",
  "signature": "<canonical-Ed25519-base64>"
}
```

The signature input is the UTF-8 newline-joined ordered values produced by
`operatorSnapshotMessage(meta)`, with the explicit
`ProtocolIA-S2C-operator-bundle-Ed25519-v1` domain prefix and a trailing
newline. Missing `internalReturns` signs the reserved `ABSENT` sentinel;
an empty present journal signs the SHA-256 of literal `[]`, so these are
not interchangeable. The input manifest parser rejects duplicate JSON fields
including Unicode aliases. Key must be Ed25519 SPKI with a SHA-256 fingerprint
pinned **independently** of the manifest. Freshness window is at most 24 hours.

Additional optional CLI flags (all three or none):

```sh
node scripts/vnext/reconcile-provider-statement.mjs \
  --internal internal.json --links links.json --external external.json \
  --expected-order O1 --currency ARS --scale 2 \
  --operator-bundle-manifest operator-bundle.json \
  --operator-public-key operator-public.pem \
  --trusted-operator-key-sha256 <sha256-spki-der>
```

The API returns `operatorSnapshotAttestation.exactInputBytesBound=true`
ONLY when the signature and every exact source digest match. It explicitly
reports `providerIdentityVerified=false` and `settlementVerified=false`.
No manifest means the existing offline behavior remains available and
does not claim binding. When separate external-provider Ed25519 and event
replay flags are supplied, the operator bundle MUST verify **before** any
local replay marker is consumed, and the final freshness check covers the
manifest as well as the other input sources.

## Test matrix

- Good pinned operator signature on exact four inputs with a benign,
  non-bank-cleared `returns_agree_unverified` comparison.
- Changing each of the four inputs after signing causes exit 1 with no
  report; the valid original data can be retried.
- Missing local returns journal is distinct from an empty supplied journal.
- Wrong public-key pin, expired/tampered signature, wrong order and partial
  CLI trust flags fail closed.
- Synthetic provider-signed event replay: stale operator crosswalk causes
  exit 1 **before** event markers; valid retry consumes exactly two events;
  subsequent identical replay is rejected.
- Direct verifier negatives for extra fields, mismatched hashes and scale.

Reproduce:

```sh
node --check packages/adapters/provider-statement-operator-bundle.mjs
node --check scripts/vnext/reconcile-provider-statement.mjs
node --test tests/vnext/provider-statement-operator-bundle.test.mjs
```

The S2c CI runs its entire test suite on Node 22 and 24 and is required along
with quality, S2a/S2b, and provider PostgreSQL/HTTP generated NestJS/Spring
checks before merge.

## Boundaries and remaining blockers

**This does not certify that a merchant/bank authored the provider statement,
that the operator signed correct data, or that an input batch is complete.**
Operator key enrollment, revocation, independent review and auditable
custody are not implemented. Replay markers remain single-host, operator
snapshots are local and nonatomic, no tenant authorization is enforced
by this offline tool, and no actual refund/chargeback is executed. Never
treat a clean comparison as money settled. Keep TL-14 #57 OPEN. Do not
deploy to production, create stable financial tags or transact real money.
