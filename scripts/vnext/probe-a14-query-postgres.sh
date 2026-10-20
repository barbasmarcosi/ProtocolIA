#!/usr/bin/env bash
set -euo pipefail
cd /work
export PROTOCOLIA_ALLOW_DEMO_AUTH=true
export PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_MANAGER_USERNAME=manager
export PROTOCOLIA_READER_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
export PROTOCOLIA_MANAGER_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
PGDATA_DIR=/tmp/a142-query-postgres
rm -rf "$PGDATA_DIR";mkdir -p "$PGDATA_DIR";chown postgres:postgres "$PGDATA_DIR"
gosu postgres initdb -D "$PGDATA_DIR" --auth-local=trust --auth-host=trust >/tmp/a142-pg-init.log
gosu postgres pg_ctl -D "$PGDATA_DIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/a142-postgres.log start >/dev/null
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
 local target="$1" db="$2" app="/work/dist/a142-$1"
 if [[ "$target" == spring ]];then
  PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$db" \
  PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
  PORT=8080 java -jar "$app/target/modular-generated-0.0.1.jar" >/tmp/a142-$target.log 2>&1 &
 else
  (
   cd "$app"
   PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
   PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
   PORT=8080 node dist/main.js
  ) >/tmp/a142-$target.log 2>&1 &
 fi
 pid=$!
 local ready=0
 for i in $(seq 1 90);do
  if [[ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)" == 200 ]];then ready=1;break;fi
  if ! kill -0 "$pid" 2>/dev/null;then break;fi
  sleep 1
 done
 if [[ "$ready" != 1 ]];then tail -n 120 /tmp/a142-"$target".log;exit 1;fi
}
for target in spring nest;do
 db="a142_search_$target"
 gosu postgres createdb -h 127.0.0.1 "$db"
 start_app "$target" "$db"
 node scripts/vnext/probe-a14-query-http.mjs seed
 node scripts/vnext/probe-a14-query-http.mjs verify
 node scripts/vnext/probe-a14-query-browser.mjs
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM ticket")" = 5
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT status FROM ticket WHERE number='K2'")" = planned
 count="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename IN ('ticket','machine') AND indexname LIKE 'idx_pia_%'")"
 test "$count" -ge 3 || { echo "A142_QUERY_INDEXES_MISSING $count";exit 1; }
 stop_app
 start_app "$target" "$db"
 node scripts/vnext/probe-a14-query-http.mjs verify
 echo "A142_${target}_POSTGRESQL_TYPED_FK_FILTERS_CHROMIUM_RESTART_AND_INDEX_PASS"
 stop_app
done
echo A142_BOTH_TARGETS_SEARCH_CONFORMANCE_COMPLETE
