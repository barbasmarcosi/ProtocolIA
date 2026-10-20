#!/usr/bin/env bash
set -euo pipefail
cd /work
export PROTOCOLIA_ALLOW_DEMO_AUTH=true PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_MANAGER_USERNAME=manager
export PROTOCOLIA_READER_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
export PROTOCOLIA_MANAGER_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
PGDATA_DIR=/tmp/a14-upgrade-pg
rm -rf "$PGDATA_DIR";mkdir -p "$PGDATA_DIR";chown postgres:postgres "$PGDATA_DIR"
gosu postgres initdb -D "$PGDATA_DIR" --auth-local=trust --auth-host=trust >/tmp/a14-upgrade-init.log
gosu postgres pg_ctl -D "$PGDATA_DIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/a14-upgrade-postgres.log start >/dev/null
pid=""
stop_app(){
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    pid=""
  fi
}
cleanup(){
  stop_app
  gosu postgres pg_ctl -D "$PGDATA_DIR" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR"
}
trap cleanup EXIT
# Same schema must produce the same fingerprint. PostgreSQL 16's plain pg_dump
# emits a random \restrict key unless --restrict-key is pinned for testing.
# This dump is READ-ONLY and never fed to psql.
schema_digest(){
 gosu postgres pg_dump --restrict-key=ProtocolIASchemaFingerprint \
   -s -h 127.0.0.1 -d "$db" -t ticket -t protocolia_audit_event \
   | sha256sum | cut -d' ' -f1
}
start_app(){
 local target="$1" db="$2" folder="$3"
 if [[ "$target" == spring ]];then
  PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$db" \
  PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
  PORT=8080 java -jar "$folder/target/modular-generated-0.0.1.jar" >/tmp/a14-upgrade-$target.log 2>&1 &
 else
  (
   cd "$folder"
   PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
   PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
   PORT=8080 node dist/main.js
  ) >/tmp/a14-upgrade-$target.log 2>&1 &
 fi
 pid=$!
 local ready=0
 for i in $(seq 1 80);do
  if [[ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)" == 200 ]];then ready=1;break;fi
  if ! kill -0 "$pid" 2>/dev/null;then break;fi
  sleep 1
 done
 if [[ "$ready" != 1 ]];then tail -n 90 /tmp/a14-upgrade-"$target".log;exit 1;fi
}
for target in spring nest;do
 db="a14_upgrade_$target"
 folder="/work/dist/a14-upgrade-$target"
 cp -a "/work/dist/a13-$target" "$folder"
 gosu postgres createdb -h 127.0.0.1 "$db"
 start_app "$target" "$db" "$folder"
 node scripts/vnext/probe-a14-evolution-http.mjs seed
 before="$(schema_digest)"
 repeat="$(schema_digest)"
 test "$before" = "$repeat" || { echo "A14_PGDUMP_NONDETERMINISTIC_SNAPSHOT"; exit 1; }
 stop_app
 node packages/cli/protocolia.mjs plan examples/vnext/facility-maintenance-a14 "$folder"
 node packages/cli/protocolia.mjs evolve examples/vnext/facility-maintenance-a14 "$folder"
 after="$(schema_digest)"
 test "$before" = "$after" || { echo "A14_EVOLUTION_UNEXPECTED_DDL";exit 1; }
 start_app "$target" "$db" "$folder"
 node scripts/vnext/probe-a14-evolution-http.mjs verify
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT technician_badge FROM ticket WHERE number='TK-EVOLVE'")" = TE-NEW
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM protocolia_audit_event WHERE resource_id='TK-EVOLVE'")" = 3
 stop_app
 echo "A14_${target}_PRESERVED_OLD_DB_AND_AUDIT_IN_PLACE_PASS"
done
echo A14_BOTH_TARGETS_SAFE_IN_PLACE_EVOLUTION_PASS
