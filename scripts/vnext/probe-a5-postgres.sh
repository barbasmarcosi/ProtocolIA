#!/usr/bin/env bash
set -euo pipefail
DBDIR=/tmp/a5-persisted-pg
rm -rf "$DBDIR"
mkdir -p "$DBDIR"
chown -R postgres:postgres "$DBDIR"
gosu postgres initdb -D "$DBDIR" --auth-local=trust --auth-host=trust >/tmp/a5-initdb.log
gosu postgres pg_ctl -D "$DBDIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/a5-postgres.log start >/dev/null
pid=""
stop_app(){
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; pid=""; fi
}
cleanup(){
  stop_app
  gosu postgres pg_ctl -D "$DBDIR" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DBDIR"
}
trap cleanup EXIT
gosu postgres createdb -h 127.0.0.1 protocolia_a5
start_app(){
  local path="$1"
  PROTOCOLIA_ALLOW_DEMO_AUTH=true \
  PROTOCOLIA_READER_USERNAME=reader \
  PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
  PROTOCOLIA_MANAGER_USERNAME=manager \
  PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
  PROTOCOLIA_JDBC_URL=jdbc:postgresql://127.0.0.1:5432/protocolia_a5 \
  PROTOCOLIA_JDBC_USER=postgres \
  PROTOCOLIA_JDBC_PASSWORD=postgres \
  PORT=8080 \
  java -jar "$path/target/modular-generated-0.0.1.jar" > /tmp/a5-runtime.log 2>&1 &
  pid=$!
  local ready=0
  for i in $(seq 1 90); do
    local status
    status="$(curl --max-time 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)"
    if [[ "$status" == "200" ]]; then ready=1; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if [[ "$ready" != "1" ]]; then
    tail -n 100 /tmp/a5-runtime.log
    exit 1
  fi
}
APP=/work/dist/relations
PROJECT=/work/examples/vnext/a4-contract-evolution-test
test -f "$APP/protocolia-ownership.json"
test -f "$APP/protocolia-contract-ir.json"
mkdir -p "$APP/extensions"
printf '%s\n' 'CONSUMER-OWNED-DO-NOT-MODIFY' > "$APP/extensions/consumer.txt"
cp "$APP/src/main/resources/db/migration/V1__contract_baseline.sql" /tmp/a5-original-v1.sql

# A direct edit in a managed file must block before npm/maven or any migration.
cp "$APP/web/src/App.jsx" /tmp/a5-generated-before.jsx
printf '\n// unauthorized manual edit\n' >> "$APP/web/src/App.jsx"
if node packages/cli/protocolia.mjs evolve "$PROJECT" "$APP" > /tmp/a5-tamper.log 2>&1; then
  echo "A5_TAMPER_NOT_REJECTED"; exit 1
fi
grep -q "Managed files modified" /tmp/a5-tamper.log
cmp /tmp/a5-original-v1.sql "$APP/src/main/resources/db/migration/V1__contract_baseline.sql"
mv /tmp/a5-generated-before.jsx "$APP/web/src/App.jsx"
echo A5_MANAGED_FILE_TAMPERING_REJECTED_PASS

start_app "$APP"
node scripts/vnext/probe-a5-http.mjs seed
stop_app

node packages/cli/protocolia.mjs plan "$PROJECT" "$APP" | tee /tmp/a5-plan.log
grep -q '"compatible":true' /tmp/a5-plan.log
echo A5_ADDITIVE_DIFF_PLAN_PASS

node packages/cli/protocolia.mjs evolve "$PROJECT" "$APP" | tee /tmp/a5-evolve.log
grep -q 'PROTOCOLIA_EVOLUTION_APPLIED' /tmp/a5-evolve.log
test -f "$APP/src/main/resources/db/migration/V2__protocolia_additive.sql"
grep -q 'ALTER TABLE inspection ADD COLUMN checked_at TIMESTAMP WITH TIME ZONE;' \
 "$APP/src/main/resources/db/migration/V2__protocolia_additive.sql"
cmp /tmp/a5-original-v1.sql "$APP/src/main/resources/db/migration/V1__contract_baseline.sql"
printf '%s\n' 'CONSUMER-OWNED-DO-NOT-MODIFY' | cmp - "$APP/extensions/consumer.txt"
node --input-type=module -e 'import {verifyApp} from "./packages/cli/ownership.mjs";verifyApp("/work/dist/relations")'
echo A5_V1_BYTES_AND_EXTENSION_PRESERVED_PASS

start_app "$APP"
node scripts/vnext/probe-a5-http.mjs verify
gosu postgres psql -h 127.0.0.1 -d protocolia_a5 -At -c \
"SELECT version FROM flyway_schema_history WHERE success=true ORDER BY installed_rank" \
  | tee /tmp/a5-flyway-versions
printf '1\n2\n' | cmp - /tmp/a5-flyway-versions
echo A5_FLYWAY_V1_TO_V2_IN_PLACE_DATA_PRESERVED_PASS
