#!/usr/bin/env bash
set -euo pipefail
cd /work
PGDIR=/tmp/protocolia-a12-pg
rm -rf "$PGDIR"
mkdir -p "$PGDIR"
chown -R postgres:postgres "$PGDIR"
gosu postgres initdb -D "$PGDIR" --auth-local=trust --auth-host=trust >/tmp/a12-init.log
gosu postgres pg_ctl -D "$PGDIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/a12-pg.log start >/dev/null
pid=""
stop_app(){
  if [[ -n "$pid" ]];then kill "$pid" 2>/dev/null || true;wait "$pid" 2>/dev/null || true;pid="";fi
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
  PORT=8080 java -jar "$app/target/modular-generated-0.0.1.jar" >/tmp/a12-"$target".log 2>&1 &
 else
  (
   cd "$app"
   PROTOCOLIA_ALLOW_DEMO_AUTH=true \
   PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
   PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
   PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
   PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
   PORT=8080 node dist/main.js
  ) >/tmp/a12-"$target".log 2>&1 &
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
  echo "A12_BOOT_FAILED target=$target"
  tail -n 120 "/tmp/a12-$target.log"
  exit 1
 fi
}
for target in spring nest;do
 db="protocolia_a12_$target"
 gosu postgres createdb -h 127.0.0.1 "$db"
 app="/work/dist/a12-$target-upgraded"
 cp -a "/work/dist/a12-$target-a10" "$app"
 mkdir -p "$app/extensions"
 printf 'A12-CONSUMER-PRESERVED\n' > "$app/extensions/keep.txt"
 if [[ "$target" == spring ]];then
  baseline="$app/src/main/resources/db/migration/V1__contract_baseline.sql"
  patchdir="$app/src/main/resources/db/migration"
 else
  baseline="$app/src/schema.sql"
  patchdir="$app/src/migrations"
 fi
 cp "$baseline" "/tmp/a12-$target-baseline.sql"
 start_app "$target" "$app" "$db"
 node scripts/vnext/probe-workflow-http.mjs || { tail -n 120 "/tmp/a12-$target.log";exit 1; }
 node --input-type=module -e '
  const auth="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
  const base="http://127.0.0.1:8080";
  const out=await fetch(base+"/api/work-orders/W-001/audit",{headers:{Authorization:auth}});
  if(out.status!==404)throw Error("A10 must not expose audit read "+out.status);
  const inserted=await fetch(base+"/api/work-orders",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},
   body:JSON.stringify({code:"W-AUDFAIL",title:"Existing audited order",status:"draft"})});
  if(inserted.status!==201)throw Error("Could not seed second audited work order "+inserted.status);
  const manager=await fetch(base+"/api/_protocolia/me",{headers:{Authorization:auth}});
  if((await manager.json()).capabilities.includes("orders.audit"))throw Error("A10 unexpectedly holds audit reader permission");'
 stop_app
 before="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
  "SELECT string_agg(id||':'||entity_name||':'||resource_id||':'||operation_name||':'||field_name||':'||COALESCE(before_value,'NULL')||'>'||COALESCE(after_value,'NULL')||':'||actor,',' ORDER BY id) FROM protocolia_audit_event")"
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM protocolia_audit_event")" = 6
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM work_order")" = 2
 if [[ "$target" == spring ]];then
  history="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT version FROM flyway_schema_history WHERE success=true ORDER BY installed_rank")"
  test "$history" = 1
 else
  history="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT digest FROM protocolia_schema_history")"
  test "${#history}" = 64
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM protocolia_nest_migration_history")" = 0
 fi
 echo "A12_${target}_A10_PERSISTED_BASELINE_AND_SIX_EVENTS_PASS"
 contract="/work/examples/vnext/work-orders"
 node packages/cli/protocolia.mjs plan "$contract" "$app" | tee "/tmp/a12-$target-plan.log"
 grep -q '"compatible":true' "/tmp/a12-$target-plan.log"
 grep -q '"kind":"addOperation"' "/tmp/a12-$target-plan.log"
 grep -q '"kind":"auditPage"' "/tmp/a12-$target-plan.log"
 # A10 remains untouched if a new contract changes historical audit fields.
 node scripts/vnext/probe-a12-negative.mjs "$app" "$contract"
 node packages/cli/protocolia.mjs evolve "$contract" "$app" | tee "/tmp/a12-$target-evolve.log"
 grep -q PROTOCOLIA_EVOLUTION_APPLIED "/tmp/a12-$target-evolve.log"
 cmp "/tmp/a12-$target-baseline.sql" "$baseline"
 test "$(find "$patchdir" -maxdepth 1 -name 'V2__*.sql' | wc -l)" = 0
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM protocolia_audit_event")" = 6
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM work_order")" = 2
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
  "SELECT string_agg(id||':'||entity_name||':'||resource_id||':'||operation_name||':'||field_name||':'||COALESCE(before_value,'NULL')||'>'||COALESCE(after_value,'NULL')||':'||actor,',' ORDER BY id) FROM protocolia_audit_event")" = "$before"
 test "$(cat "$app/extensions/keep.txt")" = A12-CONSUMER-PRESERVED
 node --input-type=module -e 'import {verifyApp} from "./packages/cli/ownership.mjs";verifyApp(process.argv[1])' "$app"
 echo "A12_${target}_ZERO_DDL_EVOLUTION_BASELINE_OWNERSHIP_AND_JOURNAL_PRESERVED_PASS"
 start_app "$target" "$app" "$db"
 node scripts/vnext/probe-a11-audit-http.mjs || { tail -n 140 "/tmp/a12-$target.log";exit 1; }
 node scripts/vnext/probe-a11-audit-browser.mjs || { tail -n 140 "/tmp/a12-$target.log";exit 1; }
 if [[ "$target" == spring ]];then
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT version FROM flyway_schema_history WHERE success=true ORDER BY installed_rank")" = "$history"
 else
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT digest FROM protocolia_schema_history")" = "$history"
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM protocolia_nest_migration_history")" = 0
 fi
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
  "SELECT string_agg(id||':'||entity_name||':'||resource_id||':'||operation_name||':'||field_name||':'||COALESCE(before_value,'NULL')||'>'||COALESCE(after_value,'NULL')||':'||actor,',' ORDER BY id) FROM protocolia_audit_event")" = "$before"
 echo "A12_${target}_A10_TO_A11_POSTGRES_HTTP_CHROMIUM_IN_PLACE_PASS"
 stop_app
 node packages/cli/protocolia.mjs plan "$contract" "$app" | tee "/tmp/a12-$target-replan.log"
 grep -q '"changes":\[\]' "/tmp/a12-$target-replan.log"
 node packages/cli/protocolia.mjs evolve "$contract" "$app" | tee "/tmp/a12-$target-reevolve.log"
 grep -q PROTOCOLIA_EVOLUTION_NO_CHANGES "/tmp/a12-$target-reevolve.log"
 start_app "$target" "$app" "$db"
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM work_order")" = 2
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM protocolia_audit_event")" = 6
 echo "A12_${target}_SECOND_START_IDEMPOTENT_EVOLUTION_AND_DATA_PRESERVED_PASS"
 stop_app
done
