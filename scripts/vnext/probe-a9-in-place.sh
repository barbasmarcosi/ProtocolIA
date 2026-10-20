#!/usr/bin/env bash
set -euo pipefail
cd /work
PGDIR=/tmp/protocolia-a9-pg
rm -rf "$PGDIR"
mkdir -p "$PGDIR"
chown -R postgres:postgres "$PGDIR"
gosu postgres initdb -D "$PGDIR" --auth-local=trust --auth-host=trust >/tmp/a9-init.log
gosu postgres pg_ctl -D "$PGDIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/a9-pg.log start >/dev/null
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
  local target="$1" app="$2" db="$3"
  if [[ "$target" == spring ]];then
    PROTOCOLIA_ALLOW_DEMO_AUTH=true \
    PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
    PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
    PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$db" \
    PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
    PORT=8080 java -jar "$app/target/modular-generated-0.0.1.jar" >/tmp/a9-"$target".log 2>&1 &
  else
    (
      cd "$app"
      PROTOCOLIA_ALLOW_DEMO_AUTH=true \
      PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
      PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
      PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
      PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
      PORT=8080 node dist/main.js
    ) >/tmp/a9-"$target".log 2>&1 &
  fi
  pid="$!"
  local ready=0
  for i in $(seq 1 80);do
    local code
    code="$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)"
    if [[ "$code" == "200" ]];then ready=1;break;fi
    if ! kill -0 "$pid" 2>/dev/null;then break;fi
    sleep 1
  done
  if [[ "$ready" != 1 ]];then
    echo "A9_BOOT_FAILED target=$target app=$app"
    tail -n 120 /tmp/a9-"$target".log
    exit 1
  fi
}
for target in spring nest;do
  db="protocolia_a9_$target"
  gosu postgres createdb -h 127.0.0.1 "$db"
  old="/work/dist/a9-$target-v1"
  app="/work/dist/a9-$target-upgraded"
  contract="/work/examples/vnext/inventory-reservations"
  cp -a "$old" "$app"
  mkdir -p "$app/extensions"
  printf 'A9-CONSUMER-OWNED\n' > "$app/extensions/consumer.txt"
  if [[ "$target" == spring ]];then
    baseline="$app/src/main/resources/db/migration/V1__contract_baseline.sql"
  else
    baseline="$app/src/schema.sql"
  fi
  cp "$baseline" /tmp/a9-"$target"-original.sql
  start_app "$target" "$app" "$db"
  node scripts/vnext/probe-a9-seed.mjs
  stop_app
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM allocation")" = "2"
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT available FROM part WHERE sku='P-MIG'")" = "7"
  node packages/cli/protocolia.mjs plan "$contract" "$app" | tee /tmp/a9-"$target"-plan.log
  grep -q '"compatible":true' /tmp/a9-"$target"-plan.log
  grep -q '"kind":"addInitialState"' /tmp/a9-"$target"-plan.log
  grep -q '"kind":"addOperation"' /tmp/a9-"$target"-plan.log
  node packages/cli/protocolia.mjs evolve "$contract" "$app" | tee /tmp/a9-"$target"-evolve.log
  grep -q PROTOCOLIA_EVOLUTION_APPLIED /tmp/a9-"$target"-evolve.log
  cmp /tmp/a9-"$target"-original.sql "$baseline"
  if [[ "$target" == spring ]];then
    migration="$app/src/main/resources/db/migration/V2__protocolia_additive.sql"
  else
    migration="$app/src/migrations/V2__protocolia_additive.sql"
  fi
  test -f "$migration"
  grep -q "ALTER TABLE allocation ADD COLUMN status VARCHAR(20)" "$migration"
  grep -q "DEFAULT 'active' NOT NULL" "$migration"
  grep -q "CHECK (status IN ('active','cancelled'))" "$migration"
  grep -qx A9-CONSUMER-OWNED "$app/extensions/consumer.txt"
  node --input-type=module -e 'import {verifyApp} from "./packages/cli/ownership.mjs";verifyApp(process.argv[1])' "$app"
  echo "A9_${target}_V1_BASELINE_AND_EXTENSIONS_PRESERVED_PASS"

  start_app "$target" "$app" "$db"
  node scripts/vnext/probe-a9-upgraded.mjs || { tail -n 100 /tmp/a9-"$target".log; exit 1; }
  node scripts/vnext/probe-a9-browser.mjs || { tail -n 100 /tmp/a9-"$target".log; exit 1; }
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT available FROM part WHERE sku='P-MIG'")" = "10"
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT status FROM allocation WHERE number='R-LEGACY'")" = cancelled
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM allocation")" = 3
  if [[ "$target" == spring ]];then
    gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
      "SELECT version FROM flyway_schema_history WHERE success=true ORDER BY installed_rank" \
      | cmp - <(printf '1\n2\n')
  else
    gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
      "SELECT version FROM protocolia_nest_migration_history ORDER BY version" \
      | cmp - <(printf '2\n')
  fi
  echo "A9_${target}_PERSISTED_BACKFILL_HTTP_CHROMIUM_AND_JOURNAL_PASS"
  stop_app
  start_app "$target" "$app" "$db"
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT available FROM part WHERE sku='P-MIG'")" = "10"
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM allocation")" = "3"
  echo "A9_${target}_SECOND_STARTUP_PRESERVES_ROWS_PASS"
  stop_app
done
