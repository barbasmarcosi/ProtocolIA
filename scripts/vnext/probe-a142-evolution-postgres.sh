#!/usr/bin/env bash
set -euo pipefail
cd /work
export PROTOCOLIA_ALLOW_DEMO_AUTH=true PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_MANAGER_USERNAME=manager
export PROTOCOLIA_READER_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
export PROTOCOLIA_MANAGER_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
PGDATA_DIR=/tmp/a142-upgrade-pg
rm -rf "$PGDATA_DIR";mkdir -p "$PGDATA_DIR";chown postgres:postgres "$PGDATA_DIR"
gosu postgres initdb -D "$PGDATA_DIR" --auth-local=trust --auth-host=trust >/tmp/a142-upgrade-init.log
gosu postgres pg_ctl -D "$PGDATA_DIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/a142-upgrade-postgres.log start >/dev/null
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
start_app(){
 local target="$1" db="$2" folder="$3"
 if [[ "$target" == spring ]];then
  PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$db" \
  PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
  PORT=8080 java -jar "$folder/target/modular-generated-0.0.1.jar" >/tmp/a142-upgrade-$target.log 2>&1 &
 else
  (
   cd "$folder"
   PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
   PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
   PORT=8080 node dist/main.js
  ) >/tmp/a142-upgrade-$target.log 2>&1 &
 fi
 pid=$!
 local ready=0
 for i in $(seq 1 80);do
  if [[ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)" == 200 ]];then ready=1;break;fi
  if ! kill -0 "$pid" 2>/dev/null;then break;fi
  sleep 1
 done
 if [[ "$ready" != 1 ]];then tail -n 90 /tmp/a142-upgrade-"$target".log;exit 1;fi
}
for target in spring nest;do
 db="a142_upgrade_$target"
 folder="/work/dist/a142-upgrade-$target"
 cp -a "/work/dist/a13-$target" "$folder"
 gosu postgres createdb -h 127.0.0.1 "$db"
 start_app "$target" "$db" "$folder"
 node scripts/vnext/probe-a14-evolution-http.mjs seed
 # Read-only contract addition must preserve pre-existing table and audit DDL.
 # The only permitted new DDL is idx_pia_* query indexes, asserted separately below.
 before="$(gosu postgres pg_dump -s -h 127.0.0.1 -d "$db" -t ticket -t protocolia_audit_event | sed '/^CREATE INDEX idx_pia_[a-f0-9]\{12\} ON /d' | sha256sum | cut -d' ' -f1)"
 stop_app
 node packages/cli/protocolia.mjs plan examples/vnext/facility-maintenance-a142 "$folder"
 node packages/cli/protocolia.mjs evolve examples/vnext/facility-maintenance-a142 "$folder"
 after="$(gosu postgres pg_dump -s -h 127.0.0.1 -d "$db" -t ticket -t protocolia_audit_event | sed '/^CREATE INDEX idx_pia_[a-f0-9]\{12\} ON /d' | sha256sum | cut -d' ' -f1)"
 test "$before" = "$after" || { echo "A14_EVOLUTION_UNEXPECTED_DDL";exit 1; }
 start_app "$target" "$db" "$folder"
 node scripts/vnext/probe-a14-evolution-http.mjs verify
 node --input-type=module -e '
 const auth="Basic "+Buffer.from("reader:"+process.env.PROTOCOLIA_READER_PASSWORD).toString("base64");
 const url="http://127.0.0.1:8080/api/tickets/query/filtered?siteCode=S-EVOLVE&status=reported";
 const res=await fetch(url,{headers:{Authorization:auth}});
 if(res.status!==200)throw Error("Evolved query route HTTP "+res.status);
 const data=await res.json();
 if(data.total!==1||data.items[0]?.number!=="TK-EVOLVE"||
    data.items[0]?.technicianBadge!=="TE-NEW")
   throw Error("A14.2 evolved search lost prior row/reassignment");
 '
 indexes="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'idx_pia_%'")"
 test "$indexes" -ge 3 || { echo "A142_EVOLUTION_MISSING_INDEXES $indexes";exit 1; }
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT technician_badge FROM ticket WHERE number='TK-EVOLVE'")" = TE-NEW
 test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT count(*) FROM protocolia_audit_event WHERE resource_id='TK-EVOLVE'")" = 3
 stop_app
 echo "A142_${target}_EVOLVED_QUERY_PRESERVED_ROWS_AUDIT_AND_INDEXES_PASS"
done
echo A142_BOTH_TARGETS_SAFE_IN_PLACE_SEARCH_EVOLUTION_PASS
