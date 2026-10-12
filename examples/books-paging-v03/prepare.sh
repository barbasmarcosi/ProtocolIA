#!/bin/sh
# Independent opt-in v0.3 Java Books pagination experiment; never touches the
# existing stock-change comparison fixture or frozen ProtocolIA P4 study.
set -eu
OUT="target/books-paging-v03-generated"
if [ "$#" -gt 0 ]; then OUT="$1"; fi
PYTHONPATH=src python3 -m protocolia generate-java \
  examples/books-paging-v03/contract.json --out "$OUT"
PYTHONPATH=src python3 -m protocolia compile-bundle \
  examples/books-paging-v03/contract.json \
  --profile java-spring-basic-demo \
  --resources examples/books-paging-v03/resources.json \
  --domain-errors examples/books-paging-v03/http-errors.json \
  --out "$OUT/contract-bundle"
MAIN="$OUT/src/main/java/dev/protocolia/generated/custom"
TEST="$OUT/src/test/java/dev/protocolia/generated/custom"
mkdir -p "$MAIN" "$TEST"
cp examples/books-paging-v03/CatalogHandlers.java "$MAIN/CatalogHandlers.java"
cp examples/catalog-vertical/CatalogVerticalTest.java "$TEST/CatalogVerticalTest.java"
cp examples/stock-change/protocolia/StockAdjustmentContractTest.java "$TEST/StockAdjustmentContractTest.java"
cp examples/books-paging-v03/BooksPaginationHttpTest.java "$TEST/BooksPaginationHttpTest.java"
echo "READY real paginated Books v0.3 service at $OUT"
