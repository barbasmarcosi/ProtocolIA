#!/usr/bin/env bash
set -euo pipefail
cd /work
export PROTOCOLIA_ALLOW_DEMO_AUTH=true
export PROTOCOLIA_READER_USERNAME=reader
export PROTOCOLIA_MANAGER_USERNAME=manager
export PROTOCOLIA_READER_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
export PROTOCOLIA_MANAGER_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
PGDATA_DIR=/tmp/a14-reassignment-pg
rm -rf "$PGDATA_DIR"
mkdir -p "$PGDATA_DIR"
chown -R postgres:postgres "$PGDATA_DIR"
gosu postgres initdb -D "$PGDATA_DIR" --auth-local=trust --auth-host=trust >/tmp/a14-pg-init.log
gosu postgres pg_ctl -D "$PGDATA_DIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/a14-pg.log start >/dev/null
pid=""
stop_app(){
 if [[ -n "$pid" ]];then kill "$pid" 2>/dev/null || true;wait "$pid" 2>/dev/null || true;pid="";fi
}
cleanup(){
 stop_app
 gosu postgres pg_ctl -D "$PGDATA_DIR" stop -m immediate >/dev/null 2>&1 || true
 rm -rf "$PGDATA_DIR"
}
trap cleanup EXIT
start_app(){
 local target="$1" db="$2" app="/work/dist/a14-$1"
 if [[ "$target" == spring ]];then
  PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$db" \
  PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
  PORT=8080 java -jar "$app/target/modular-generated-0.0.1.jar" >/tmp/a14-$target.log 2>&1 &
 else
  (
   cd "$app"
   PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
   PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
   PORT=8080 node dist/main.js
  ) >/tmp/a14-$target.log 2>&1 &
 fi
 pid=$!
 local ready=0
 for i in $(seq 1 90);do
  if [[ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)" == 200 ]];then ready=1;break;fi
  if ! kill -0 "$pid" 2>/dev/null;then break;fi
  sleep 1
 done
 if [[ "$ready" != 1 ]];then tail -n 100 /tmp/a14-"$target".log;exit 1;fi
}
for target in spring nest;do
 db="a14_reassign_$target"
 gosu postgres createdb -h 127.0.0.1 "$db"
 start_app "$target" "$db"
 node scripts/vnext/probe-a14-reassign-http.mjs seed
 gosu postgres psql -h 127.0.0.1 -d "$db" -v ON_ERROR_STOP=1 -f tests/vnext/a14-audit-failure.sql >/dev/null
 node scripts/vnext/probe-a14-reassign-http.mjs fail-audit
 gosu postgres psql -h 127.0.0.1 -d "$db" -v ON_ERROR_STOP=1 -c "DROP TRIGGER protocolia_a14_test_audit_failure ON protocolia_audit_event; DROP FUNCTION protocolia_a14_test_block_audit();" >/dev/null
 node scripts/vnext/probe-a14-reassign-http.mjs recover
 node scripts/vnext/probe-a14-reassign-browser.mjs
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT technician_badge FROM ticket WHERE number='TK-A14'")" = TE-A
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT COUNT(*) FROM protocolia_audit_event WHERE resource_id='TK-A14'")" = 5
 stop_app
 start_app "$target" "$db"
 node --input-type=module -e '
  const auth="Basic "+Buffer.from("reader:"+process.env.PROTOCOLIA_READER_PASSWORD).toString("base64");
  const r=await fetch("http://127.0.0.1:8080/api/tickets/TK-A14",{headers:{Authorization:auth}});
  if(r.status!==200||(await r.json()).technicianBadge!=="TE-A")throw Error("Reassignment lost after restart");
 '
 echo "A14_${target}_REASSIGNMENT_HTTP_PG_CHROMIUM_RESTART_PASS"
 stop_app
done
echo A14_BOTH_TARGETS_REASSIGNMENT_PASS
