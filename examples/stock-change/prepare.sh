#!/bin/sh
# Product maintenance comparison, generated path; run from repository root.
set -eu
OUT=target/stock-change-generated
if [ "$#" -gt 0 ]; then OUT="$1"; fi
PYTHONPATH=src python3 -m protocolia generate-java \
  examples/stock-change/protocolia/contract.json --out "$OUT"
MAIN="$OUT/src/main/java/dev/protocolia/generated/custom"
TEST="$OUT/src/test/java/dev/protocolia/generated/custom"
mkdir -p "$MAIN" "$TEST"
cp examples/stock-change/protocolia/CatalogHandlers.java "$MAIN/CatalogHandlers.java"
cp examples/catalog-vertical/CatalogVerticalTest.java "$TEST/CatalogVerticalTest.java"
cp examples/stock-change/protocolia/StockAdjustmentContractTest.java "$TEST/StockAdjustmentContractTest.java"
# Emit validated resource/UI/capability projections for downstream clients.
PYTHONPATH=src python3 -m protocolia compile-bundle \
  examples/stock-change/protocolia/contract.json \
  --profile java-spring-basic-demo \
  --resources examples/stock-change/protocolia/resources.json \
  --domain-errors examples/stock-change/protocolia/http-errors.json \
  --out "$OUT/contract-bundle"
# Emit the truthful Java Basic demo OpenAPI separately from generic v0.2 output.
PYTHONPATH=src python3 -m protocolia compile-http \
  examples/stock-change/protocolia/contract.json \
  --profile java-spring-basic-demo \
  --domain-errors examples/stock-change/protocolia/http-errors.json \
  --out "$OUT/contract-http"
echo "READY real generated stock-change app at $OUT"
