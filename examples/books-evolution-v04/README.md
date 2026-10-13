# G5 v0.4 — verified Books vertical

**Pilot accepted 2026-10-13:** contract field `publishedAt` and
new `renameBook` PATCH action propagate into generated API/Orval/RJSF,
real JDBC/Flyway V2, signed-JWT security checks and browser E2E.
See [closeout evidence](../../docs/G5_CONTRACT_EVOLUTION_PROGRESS.md).


This is the narrow, experimentally supported optional+nullable scalar field
profile, **not** a general-purpose application generator.

`publishedAt` is optional and nullable on `Book` and `BookRequest`. A
missing field and explicit JSON null both become Java null. The generated
OpenAPI 3.1, JSON Schema 2020-12, TypeScript, Java API and view manifests
derive from `contract.json` + `resources.json`. Handwritten JDBC,
application authorization and Flyway migrations remain reviewed, **user-owned**.

For existing G3/v0.3 frontend behavior use `examples/books-web`; for
v0.4 run the isolated `examples/books-web-v04` template. To inspect
second-resource generality, see `examples/g5-second-resource`.

## One safe generation command

Install Java 21 and Node 22, and fetch **the pinned OpenAPI Generator CLI
7.26.0 jar** from upstream. From the repository root:

```sh
PYTHONPATH=src python3 -m protocolia regenerate-fullstack \
  examples/books-evolution-v04/contract.json \
  --profile java-spring-basic-demo \
  --resources examples/books-evolution-v04/resources.json \
  --domain-errors examples/books-paging-v03/http-errors.json \
  --java-generator-jar /path/to/openapi-generator-cli-7.26.0.jar \
  --web-template examples/books-web-v04 \
  --out generated/books-v04
```

The output path must be exclusively owned by this command. It contains:
`bundle/*`, `java/src/main/java/*`, `web/src/generated/orval/*`,
`source-contract.json` and a SHA-256 ownership manifest. The tool:

1. Rejects existing unmanaged output, altered generated artifacts, symlinks
   and incompatible source contract/resource changes **before** generation.
2. Generates into a disposable staging tree, runs OpenAPI Generator and Orval,
   and regenerates each twice to verify source byte identity.
3. Promotes only the **whole generated output root**. It never writes into
   manually controlled `src/main/java`, React UI, SQL migrations, POM,
   `src/api/http.ts`, or `src/api/cache.ts` source trees.
4. On a normal POSIX filesystem, switches the managed directory via
   verified backup/install steps, restoring it on ordinary I/O failure.
   Filesystem interruption between directory operations and Docker OverlayFS
   cross-layer renames are **not** promised to be atomic; on unsupported
   renames it fails closed rather than overwriting earlier managed output.
5. Refuses same-version breaking model/operation/capability/view changes,
   requiring an explicit reviewed migration/new generated output root.

**Important:** this command emits API/client/schemas, **not handwritten
persistence, business invariants or IAM policy**. The real PostgreSQL v0.4
tests and real Chromium browser tests are in
`experiments/g5-contract-evolution/Dockerfile`; their final Render image
exposes only a safe /health marker.

See `docs/G5_CONTRACT_EVOLUTION_PROGRESS.md` for pinned test evidence and
remaining nonproduction deployment obligations.
