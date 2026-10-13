#!/bin/sh
# Run from the ProtocolIA repository root; do not mutate upstream fixtures.
set -eu
DEST="examples/books-web-v04/contract-bundle"
PYTHONPATH=src python3 -m protocolia compile-bundle \
 examples/books-evolution-v04/contract.json \
 --profile java-spring-basic-demo \
 --resources examples/books-evolution-v04/resources.json \
 --domain-errors examples/books-paging-v03/http-errors.json \
 --out "$DEST"
cp "$DEST/openapi.json" examples/books-web-v04/openapi.json
echo "G2 canonical OpenAPI ready"
