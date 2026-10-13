#!/usr/bin/env bash
set -euo pipefail
cd /work
PGDIR=/tmp/protocolia-nest-relations-pg
rm -rf "$PGDIR"
mkdir -p "$PGDIR"
chown -R postgres:postgres "$PGDIR"
gosu postgres initdb -D "$PGDIR" --auth-local=trust --auth-host=trust >/tmp/nest-relations-initdb.log
gosu postgres pg_ctl -D "$PGDIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/nest-relations-postgres.log start >/dev/null
pid=""
stop_app(){
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; pid=""; fi
}
cleanup(){
  stop_app
  gosu postgres pg_ctl -D "$PGDIR" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDIR"
}
trap cleanup EXIT
start_app(){
  local project="$1" db="$2"
  (
    cd "$project"
    PROTOCOLIA_ALLOW_DEMO_AUTH=true \
    PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
    PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
    PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
    PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
    PORT=8080 node dist/main.js
  ) > /tmp/nest-relations-app.log 2>&1 &
  pid="$!"
  local ready=0
  for i in $(seq 1 65); do
    local status
    status="$(curl --max-time 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)"
    if [[ "$status" == "200" ]]; then ready=1; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if [[ "$ready" != 1" ]]; then
    echo A3_NEST_RELATIONS_BOOT_FAILED
    tail -n 100 /tmp/nest-relations-app.log
    exit 1
  fi
}
gosu postgres createdb -h 127.0.0.1 protocolia_nest_relations
start_app /work/dist/nest-relations protocolia_nest_relations
node scripts/vnext/probe-a4-http.mjs
node scripts/vnext/probe-a4-browser.mjs
PROTOCOLIA_ALLOW_CONFORMANCE_WRITES=true \
PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
node packages/cli/conformance.mjs /work/dist/nest-relations http://127.0.0.1:8080
node scripts/vnext/probe-a4-cleanup.mjs
gosu postgres psql -h 127.0.0.1 -d protocolia_nest_relations -At -c \
 "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_name='inspection'" | grep -qx '1'
echo A3_NEST_MULTIRESOURCE_FK_BROWSER_CONFORMANCE_PASS
stop_app

# The second database remains the same throughout V1→V2; only generated code evolves.
gosu postgres createdb -h 127.0.0.1 protocolia_nest_evolution
APP=/work/dist/nest-evolution
cp -a /work/dist/nest-relations "$APP"
CONTRACT=/work/examples/vnext/a4-contract-evolution-test
mkdir -p "$APP/extensions"
printf '%s\n' 'CONSUMER-OWNED-V1' > "$APP/extensions/consumer.txt"
cp "$APP/src/schema.sql" /tmp/nest-v1-schema.sql
cp "$APP/web/src/App.jsx" /tmp/nest-v1-app.jsx

printf '\n// unapproved edit\n' >> "$APP/web/src/App.jsx"
if node packages/cli/protocolia.mjs evolve "$CONTRACT" "$APP" >/tmp/nest-tamper.log 2>&1; then
  echo A5_NEST_UNSEALED_OVERWRITE_NOT_REJECTED
  exit 1
fi
grep -q 'Managed files modified' /tmp/nest-tamper.log
mv /tmp/nest-v1-app.jsx "$APP/web/src/App.jsx"
echo A5_NEST_MANAGED_OUTPUT_TAMPER_REJECTED_PASS

start_app "$APP" protocolia_nest_evolution
node scripts/vnext/probe-a5-http.mjs seed
stop_app
node packages/cli/protocolia.mjs plan "$CONTRACT" "$APP" | tee /tmp/nest-plan.log
grep -q '"compatible":true' /tmp/nest-plan.log
node packages/cli/protocolia.mjs evolve "$CONTRACT" "$APP" | tee /tmp/nest-evolution.log
grep -q 'PROTOCOLIA_EVOLUTION_APPLIED' /tmp/nest-evolution.log
cmp /tmp/nest-v1-schema.sql "$APP/src/schema.sql"
test -f "$APP/src/migrations/V2__protocolia_additive.sql"
grep -q 'ALTER TABLE inspection ADD COLUMN checked_at TIMESTAMP WITH TIME ZONE;' \
  "$APP/src/migrations/V2__protocolia_additive.sql"
printf '%s\n' CONSUMER-OWNED-V1 | cmp - "$APP/extensions/consumer.txt"
node --input-type=module -e 'import {verifyApp} from "./packages/cli/ownership.mjs";verifyApp("/work/dist/nest-evolution")'
echo A5_NEST_BASELINE_BYTES_EXTENSIONS_AND_V2_SEAL_PASS

start_app "$APP" protocolia_nest_evolution
node scripts/vnext/probe-a5-http.mjs verify
gosu postgres psql -h 127.0.0.1 -d protocolia_nest_evolution -At -c \
 "SELECT version FROM protocolia_nest_migration_history ORDER BY version;" | grep -qx '2'
echo A5_NEST_IN_PLACE_V1_V2_PERSISTED_ROWS_AND_CHECKSUM_JOURNAL_PASS
stop_app

# Altering an applied V2 is a hard failure; never auto-clean or rewrite DB data.
cp "$APP/src/migrations/V2__protocolia_additive.sql" /tmp/nest-original-v2.sql
printf '\n-- mutated migration checksum\n' >> "$APP/src/migrations/V2__protocolia_additive.sql"
(
  cd "$APP"
  PROTOCOLIA_ALLOW_DEMO_AUTH=true \
  PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
  PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
  PROTOCOLIA_JDBC_URL=postgresql://127.0.0.1:5432/protocolia_nest_evolution \
  PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
  PORT=8080 node dist/main.js
) >/tmp/nest-checksum-negative.log 2>&1 &
negative_pid=$!
sleep 3
if [[ "$(curl --max-time 1 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)" == "200" ]]; then
  echo A5_NEST_ALTERED_MIGRATION_WAS_ACCEPTED
  kill "$negative_pid" 2>/dev/null || true
  exit 1
fi
grep -q 'migration checksum/history drift detected' /tmp/nest-checksum-negative.log
kill "$negative_pid" 2>/dev/null || true
wait "$negative_pid" 2>/dev/null || true
mv /tmp/nest-original-v2.sql "$APP/src/migrations/V2__protocolia_additive.sql"
node --input-type=module -e 'import {verifyApp} from "./packages/cli/ownership.mjs";verifyApp("/work/dist/nest-evolution")'
echo A5_NEST_CHANGED_APPLIED_MIGRATION_REFUSED_PASS
