#!/usr/bin/env bash
set -euo pipefail
npm run build:vnext
for fixture in tests/vnext/negative-*.tsp; do
  log="$(mktemp)"
  if ./node_modules/.bin/tsp compile "$fixture" --emit @protocolia/compiler >"$log" 2>&1; then
    echo "Unexpected compile SUCCESS: $fixture"; cat "$log"; exit 1
  fi
  grep -q 'protocolia-' "$log" || { cat "$log"; exit 1; }
  echo "EXPECTED FAIL $fixture"
  rm -f "$log"
done
