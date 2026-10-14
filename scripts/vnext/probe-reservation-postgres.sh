#!/usr/bin/env bash
set -euo pipefail
DBDIR=/tmp/protocolia-a7-reserve-pg
mkdir -p "$DBDIR"
chown -R postgres:postgres "$DBDIR"
gosu postgres initdb -D "$DBDIR" --auth-local=trust --auth-host=trust >/tmp/a7-initdb.log
gosu postgres pg_ctl -D "$DBDIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/a7-postgres.log start >/dev/null
pid=""
stop_app(){ if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; pid=""; fi; }
cleanup(){ stop_app; gosu postgres pg_ctl -D "$DBDIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DBDIR"; }
trap cleanup EXIT
for target in spring nest; do
  db="protocolia_a7_$target"
  gosu postgres createdb -h 127.0.0.1 "$db"
  if [[ "$target" == spring ]]; then
    PROTOCOLIA_ALLOW_DEMO_AUTH=true \
    PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
    PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
    PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$db" \
    PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
    PORT=8080 java -jar /work/dist/a7-spring/target/modular-generated-0.0.1.jar > "/tmp/a7-$target.log" 2>&1 &
  else
    (
      cd /work/dist/a7-nest
      PROTOCOLIA_ALLOW_DEMO_AUTH=true \
      PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
      PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
      PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
      PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
      PORT=8080 node dist/main.js
    ) > "/tmp/a7-$target.log" 2>&1 &
  fi
  pid="$!"
  ready=0
  for i in $(seq 1 80); do
    code="$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)"
    if [[ "$code" == "200" ]]; then ready=1; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if [[ "$ready" != "1" ]]; then echo "A7_BOOT_FAILED $target"; tail -n 110 "/tmp/a7-$target.log"; exit 1; fi
  node scripts/vnext/probe-reservation-http.mjs || { tail -n 100 "/tmp/a7-$target.log"; exit 1; }
  # Contract-derived conformance runs on a different fixture, then inspects its debited stock.
  PROTOCOLIA_ALLOW_CONFORMANCE_WRITES=true \
  PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
  PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
  node packages/cli/conformance.mjs "/work/dist/a7-$target" http://127.0.0.1:8080 \
    || { tail -n 100 "/tmp/a7-$target.log"; exit 1; }
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT available FROM part WHERE sku='P-001'")" = "0"
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM allocation WHERE part_sku='P-001'")" = "8"
  echo "A7_${target}_POSTGRES_CONSISTENCY_AND_GENERIC_CONFORMANCE_PASS"
  stop_app
done
