#!/usr/bin/env bash
set -euo pipefail
PGDIR=/tmp/protocolia-workflow-pg
mkdir -p "$PGDIR"
chown -R postgres:postgres "$PGDIR"
gosu postgres initdb -D "$PGDIR" --auth-local=trust --auth-host=trust >/tmp/workflow-initdb.log
gosu postgres pg_ctl -D "$PGDIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/workflow-postgres.log start >/dev/null
pid=""
stop_app(){ if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; pid=""; fi; }
cleanup(){ stop_app; gosu postgres pg_ctl -D "$PGDIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$PGDIR"; }
trap cleanup EXIT
for target in spring nest; do
  db="protocolia_workflow_$target"
  gosu postgres createdb -h 127.0.0.1 "$db"
  if [[ "$target" == spring ]]; then
    PROTOCOLIA_ALLOW_DEMO_AUTH=true \
    PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
    PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
    PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$db" \
    PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
    PORT=8080 java -jar /work/dist/workflow-spring/target/modular-generated-0.0.1.jar > "/tmp/workflow-$target.log" 2>&1 &
  else
    (
      cd /work/dist/workflow-nest
      PROTOCOLIA_ALLOW_DEMO_AUTH=true \
      PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
      PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
      PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
      PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
      PORT=8080 node dist/main.js
    ) > "/tmp/workflow-$target.log" 2>&1 &
  fi
  pid="$!"
  ready=0
  for i in $(seq 1 75); do
    code="$(curl --max-time 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)"
    if [[ "$code" == "200" ]]; then ready=1; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if [[ "$ready" != "1" ]]; then tail -n 100 "/tmp/workflow-$target.log"; exit 1; fi
  node scripts/vnext/probe-workflow-http.mjs || { tail -n 100 "/tmp/workflow-$target.log"; exit 1; }
  PROTOCOLIA_ALLOW_CONFORMANCE_WRITES=true \
  PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
  PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
  node packages/cli/conformance.mjs "/work/dist/workflow-$target" http://127.0.0.1:8080 \
    || { tail -n 100 "/tmp/workflow-$target.log"; exit 1; }
  gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT status FROM work_order WHERE code='W-001'" | grep -qx closed
  if gosu postgres psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -d "$db" -c     "INSERT INTO work_order (code,title,status) VALUES ('W-ROGUE','db bypass','unapproved');" > /tmp/workflow-bypass.log 2>&1; then
    echo A6_DATABASE_STATE_CHECK_BYPASSED
    exit 1
  fi
  grep -q 'check constraint' /tmp/workflow-bypass.log
  echo "A6_${target}_GUARDED_WORKFLOW_POSTGRES_HTTP_PASS"
  stop_app
done
