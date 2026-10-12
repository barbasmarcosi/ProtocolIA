#!/bin/sh
# Run from the ProtocolIA repository root; do not mutate upstream fixtures.
set -eu
DEST="examples/books-web/contract-bundle"
PYTHONPATH=src python3 -m protocolia compile-bundle \
 examples/books-paging-v03/contract.json \
 --profile java-spring-basic-demo \
 --resources examples/books-paging-v03/resources.json \
 --domain-errors examples/books-paging-v03/http-errors.json \
 --out "$DEST"
cp "$DEST/openapi.json" examples/books-web/openapi.json
echo "G2 canonical OpenAPI ready"
