#!/usr/bin/env bash
set -euo pipefail
cd /work
PGDATA_DIR=/tmp/a13-maintenance-pg
rm -rf "$PGDATA_DIR"
mkdir -p "$PGDATA_DIR"
chown -R postgres:postgres "$PGDATA_DIR"
gosu postgres initdb -D "$PGDATA_DIR" --auth-local=trust --auth-host=trust >/tmp/a13-postgres-init.log
gosu postgres pg_ctl -D "$PGDATA_DIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/a13-postgres-server.log start >/dev/null
app_pid=""
stop_app(){
 if [[ -n "$app_pid" ]];then
  kill "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  app_pid=""
 fi
}
cleanup(){
 stop_app
 gosu postgres pg_ctl -D "$PGDATA_DIR" stop -m immediate >/dev/null 2>&1 || true
 rm -rf "$PGDATA_DIR"
}
trap cleanup EXIT
start_app(){
 local framework="$1" db="$2" app="$3"
 if [[ "$framework" == spring ]];then
  PROTOCOLIA_ALLOW_DEMO_AUTH=true \
  PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
  PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
  PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$db" \
  PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
  PORT=8080 java -jar "$app/target/modular-generated-0.0.1.jar" >/tmp/a13-"$framework".log 2>&1 &
 else
  (
    cd "$app"
    PROTOCOLIA_ALLOW_DEMO_AUTH=true \
    PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
    PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
    PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
    PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
    PORT=8080 node dist/main.js
  ) >/tmp/a13-"$framework".log 2>&1 &
 fi
 app_pid=$!
 local ready=0
 for i in $(seq 1 80);do
  code="$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)"
  if [[ "$code" == 200 ]];then ready=1; break;fi
  if ! kill -0 "$app_pid" 2>/dev/null;then break;fi
  sleep 1
 done
 if [[ "$ready" != 1 ]];then
  echo "A13_BOOT_FAILURE_$framework"
  tail -n 120 "/tmp/a13-$framework.log"
  exit 1
 fi
}
for framework in spring nest;do
 db="a13_customer_$framework"
 app="/work/dist/a13-$framework"
 gosu postgres createdb -h 127.0.0.1 "$db"
 start_app "$framework" "$db" "$app"
 node scripts/vnext/probe-a13-maintenance-http.mjs || {
  tail -n 140 "/tmp/a13-$framework.log";exit 1;
 }
 node scripts/vnext/probe-a13-maintenance-browser.mjs || {
  tail -n 140 "/tmp/a13-$framework.log";exit 1;
 }
 machine_fk="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
 "SELECT count(*) FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='machine' AND constraint_type='FOREIGN KEY'")"
 ticket_fk="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
 "SELECT count(*) FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='ticket' AND constraint_type='FOREIGN KEY'")"
 test "$machine_fk" = 1 || { echo "A13_MACHINE_FK_FAIL $machine_fk";exit 1; }
 test "$ticket_fk" = 2 || { echo "A13_TICKET_DOUBLE_FK_FAIL $ticket_fk";exit 1; }
 for pair in 'site:2' 'technician:2' 'machine:3' 'ticket:3';do
  table="${pair%%:*}"; expected="${pair##*:}"
  got="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM $table")"
  test "$got" = "$expected" || { echo "A13_BAD_COUNT $table $got expected $expected";exit 1; }
 done
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
 "SELECT count(*) FROM protocolia_audit_event WHERE entity_name='Ticket' AND resource_id='TK-001'")" = 4
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
 "SELECT count(*) FROM protocolia_audit_event WHERE entity_name='Ticket' AND resource_id='TK-UI'")" = 4
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
 "SELECT status FROM ticket WHERE number='TK-UI'")" = completed
 echo "A13_${framework}_THREE_LEVEL_FK_GRAPH_AND_AUDIT_PSQL_PASS"
 snapshot="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
 "SELECT string_agg(id::text||':'||resource_id||':'||operation_name||':'||field_name||':'||actor,',' ORDER BY id) FROM protocolia_audit_event")"
 stop_app
 start_app "$framework" "$db" "$app"
 node --input-type=module -e '
   const auth="Basic "+Buffer.from("reader:test-reader-only-2026").toString("base64");
   for(const [path,expected] of [
     ["/api/sites/S-MAIN","S-MAIN"],["/api/machines/MC-UI","MC-UI"],
     ["/api/technicians/TE-A","TE-A"],["/api/tickets/TK-UI","TK-UI"]
   ]){
     const r=await fetch("http://127.0.0.1:8080"+path,{headers:{Authorization:auth}});
     if(r.status!==200)throw Error("Restart GET "+path+" returned "+r.status);
     const v=await r.json();
     if(!Object.values(v).includes(expected))throw Error("Restart identity corrupted "+path);
   }
   const item=await fetch("http://127.0.0.1:8080/api/tickets/TK-UI",{headers:{Authorization:auth}});
   if((await item.json()).status!=="completed")throw Error("Restart lost ticket state");
 '
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
 "SELECT string_agg(id::text||':'||resource_id||':'||operation_name||':'||field_name||':'||actor,',' ORDER BY id) FROM protocolia_audit_event")" = "$snapshot"
 echo "A13_${framework}_C13_PERSISTED_RESTART_ALL_RESOURCES_AUDIT_PASS"
 stop_app
done
echo A13_BOTH_TARGETS_CUSTOMER_ACCEPTANCE_HTTP_PG_CHROMIUM_COMPLETE
