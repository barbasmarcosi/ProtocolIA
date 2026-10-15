#!/usr/bin/env bash
set -euo pipefail
DBDIR=/tmp/a3-nest-pg
mkdir -p "$DBDIR"
chown -R postgres:postgres "$DBDIR"
gosu postgres initdb -D "$DBDIR" --auth-local=trust --auth-host=trust >/tmp/a3-initdb.log
gosu postgres pg_ctl -D "$DBDIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/a3-postgres.log start >/dev/null
pid=""
stop_app(){ if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; pid=""; fi; }
cleanup(){ stop_app; gosu postgres pg_ctl -D "$DBDIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DBDIR"; }
trap cleanup EXIT
start(){
  local kind="$1"
  local db="$2"
  PROTOCOLIA_ALLOW_DEMO_AUTH=true \
  PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
  PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
  PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
  PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
  PORT=8080 node dist/main.js > "/tmp/a3-$kind-nest.log" 2>&1 &
  pid="$!"
  local ready=0
  for i in $(seq 1 65); do
    local status
    status="$(curl --max-time 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)"
    if [[ "$status" == "200" ]]; then ready=1; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if [[ "$ready" != "1" ]]; then
    echo "A3_NEST_BOOT_FAILED kind=$kind"
    tail -n 110 "/tmp/a3-$kind-nest.log"
    exit 1
  fi
}
for entry in "taller:nest-taller:protocolia_nest_taller:modular" "gauge:nest-gauge:protocolia_nest_gauge:gauge"; do
  IFS=: read -r name folder db probe <<< "$entry"
  gosu postgres createdb -h 127.0.0.1 "$db"
  cd "/work/dist/$folder"
  start "$name" "$db"
  cd /work
  node "scripts/vnext/probe-$probe-http.mjs" || { tail -n 90 "/tmp/a3-$name-nest.log"; exit 1; }
  node "scripts/vnext/probe-$probe-browser.mjs" || { tail -n 90 "/tmp/a3-$name-nest.log"; exit 1; }
  PROTOCOLIA_ALLOW_CONFORMANCE_WRITES=true \
  PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
  PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
  node packages/cli/conformance.mjs "/work/dist/$folder" http://127.0.0.1:8080 \
    || { tail -n 90 "/tmp/a3-$name-nest.log"; exit 1; }
  stop_app
  echo "A3_NEST_PARITY_${name}_HTTP_POSTGRES_BROWSER_PASS"
done
