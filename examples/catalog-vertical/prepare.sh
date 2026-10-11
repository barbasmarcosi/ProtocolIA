#!/bin/sh
# Run from repository root: sh examples/catalog-vertical/prepare.sh [output-directory]
set -eu
OUT=target/catalog-vertical
if [ "$#" -gt 0 ]; then OUT="$1"; fi
PYTHONPATH=src python3 -m protocolia validate examples/catalog-vertical/contract.json
PYTHONPATH=src python3 -m protocolia generate-java examples/catalog-vertical/contract.json --out "$OUT"
for part in main test; do
    subdir="$OUT/src/$part/java/dev/protocolia/generated/custom"
    mkdir -p "$subdir"
    if [ "$part" = main ]; then
        src=examples/catalog-vertical/CatalogHandlers.java
    else
        src=examples/catalog-vertical/CatalogVerticalTest.java
    fi
    dest="$subdir/$(basename "$src")"
    if [ -L "$dest" ]; then echo "refusing custom symlink: $dest" >&2; exit 1; fi
    if [ ! -e "$dest" ]; then cp "$src" "$dest"; fi
done
echo "READY $OUT (generated HTTP controller + custom business handler)"
