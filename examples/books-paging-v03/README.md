# Books pagination — independent ProtocolIA v0.3 vertical

**Scope:** real, finite offset-paginated Java 21 / Spring Boot 4 demonstration. This example does **not** replace or modify the historical `examples/stock-change` comparison or frozen ProtocolIA P4 study.

## Contract and behavior

- `contract.json`: v0.3 explicitly adds `query` to GET `listBooks`; `limit` is integer 1–50 (default 25), `offset` integer 0–1,000,000 (default 0). This v0.3 subset **rejects** unsupported query shapes, floats, string filters, methods other than GET, and absent/ambiguous bounds; it is **not** general query support.
- `BookPage` is an explicit response model with required `items: Book[]`, `total`, `limit`, `offset`; no optional/null output semantics are assumed.
- `resources.json`: version 0.2 resource sidecar explicitly binds list/detail/create/restock, list view fields and write invalidation. It cannot mint permissions or SQL.
- `CatalogHandlers.java`: real user-owned in-memory business code that sorts by stable ISBN, returns **at most 50 books**, and handles out-of-range offsets with an empty items array and correct total; separate from generated HTTP/DTO/auth files.
- The generated controller rejects invalid `limit` and `offset` with **HTTP 400**. A first implementation using class-level `@Validated` instead exposed a real **HTTP 500** for out-of-range input, which was repaired using explicit range checks.
- HTTP Basic and in-memory users are **local demo only**. An anonymous caller cannot list books; `catalog.read` can list/get but cannot create or adjust stock. Production OAuth2 and persistence are separate gates.

## Compile and test from a clean checkout

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_v03_paging.py' -v
sh examples/books-paging-v03/prepare.sh target/books-paging-v03-generated

# Set demo credentials explicitly; use 16+ character passwords.
cd target/books-paging-v03-generated
PROTOCOLIA_USER=tester PROTOCOLIA_PASSWORD='local-test-password-123456' \
  PROTOCOLIA_SCOPES=catalog.read,catalog.write \
  PROTOCOLIA_VIEWER_USER=reader PROTOCOLIA_VIEWER_PASSWORD='local-viewer-password-123456' \
  mvn -B -ntp clean verify
```

`compile-bundle` writes a separate nine-file, manifest-owned output tree under `contract-bundle`, containing OpenAPI 3.1, JSON Schema 2020-12, typed resource IR and three resource/capability/generation manifests. `generate-java` writes generated Java HTTP/DTO sources; `prepare.sh` copies user-owned code and tests into the disposable example build only.

On a running instance, authenticated requests:

```bash
curl -u tester:'local-test-password-123456' 'http://localhost:10000/api/books?limit=2&offset=0'
curl -u tester:'local-test-password-123456' 'http://localhost:10000/api/books?limit=2&offset=2'
curl -i -u tester:'local-test-password-123456' 'http://localhost:10000/api/books?limit=0'
```

The last request must return HTTP **400**, not 500. Real integration tests independently assert responses and rights. No mock HTTP server is accepted as evidence.

## Current limitations and next step

Pagination is over an **in-memory** ConcurrentHashMap snapshot, not PostgreSQL. It does not claim transactional snapshot isolation, durable storage or scalable arbitrary offset queries. Contract v0.3 supports this intentionally narrow **integer GET query** profile only; optional/nullable JSON fields, free-form filters, cursors, compound queries, oneOf/allOf and SQL generation remain unsupported.

The verified contract/profile is intended as input for the **G1 OpenAPI Generator parity spike**. A generated application is only complete when real business handlers are installed and return non-501, independently tested outcomes.
