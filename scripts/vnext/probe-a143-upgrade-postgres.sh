#!/usr/bin/env bash
set -euo pipefail
cd /work
export PROTOCOLIA_ALLOW_DEMO_AUTH=true
export PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_MANAGER_USERNAME=manager
export PROTOCOLIA_READER_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')"
export PROTOCOLIA_MANAGER_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')"
DATA=/tmp/a143-upgrade
rm -rf "$DATA";mkdir -p "$DATA";chown postgres:postgres "$DATA"
gosu postgres initdb -D "$DATA" --auth-local=trust --auth-host=trust >/tmp/a143-upgrade-init.log
gosu postgres pg_ctl -D "$DATA" -o "-c listen_addresses=127.0.0.1" -l /tmp/a143-upgrade.log start >/dev/null
pid=""
stop_app(){
 if [[ -n "$pid" ]];then kill "$pid" 2>/dev/null || true;wait "$pid" 2>/dev/null || true;pid="";fi
}
cleanup(){
 stop_app
 gosu postgres pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
 rm -rf "$DATA"
}
trap cleanup EXIT
start_app(){
 local target="$1" db="$2" folder="$3" worker="$4"
 if [[ "$target" == spring ]];then
  PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$db" \
  PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
  PROTOCOLIA_ALERT_WORKER_ENABLED="$worker" \
  PROTOCOLIA_ALERT_INTERVAL_MS=1000 PROTOCOLIA_ALERT_INITIAL_DELAY_MS=1000 \
  PORT=8080 java -jar "$folder/target/modular-generated-0.0.1.jar" \
    >/tmp/a143-upgrade-spring.log 2>&1 &
 else
  (cd "$folder";PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
  PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
  PROTOCOLIA_ALERT_WORKER_ENABLED="$worker" PROTOCOLIA_ALERT_INTERVAL_MS=1000 \
  PORT=8080 node dist/main.js) >/tmp/a143-upgrade-nest.log 2>&1 &
 fi
 pid=$!
 local ready=0
 for i in $(seq 1 75);do
  if [[ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)" == 200 ]];then ready=1;break;fi
  if ! kill -0 "$pid" 2>/dev/null;then break;fi
  sleep 1
 done
 if [[ "$ready" != 1 ]];then tail -n 90 "/tmp/a143-upgrade-$target.log";exit 1;fi
}
for target in spring nest;do
 db="a143_upgrade_$target"
 folder="/work/dist/a143-evolved-$target"
 cp -a "/work/dist/a143-old-$target" "$folder"
 gosu postgres createdb -h 127.0.0.1 "$db"
 start_app "$target" "$db" "$folder" false
 node scripts/vnext/probe-a14-evolution-http.mjs seed
 gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" <<'SQL' >/tmp/a143-seed.log
INSERT INTO ticket(number,machine_tag,technician_badge,title,severity,due_at,status)
VALUES ('TK-ALERT-OLD','M-EVOLVE','TE-OLD','Old notice','low','2020-01-01T00:00:00Z','reported'),
('TK-ALERT-NEW','M-EVOLVE','TE-NEW','New notice','high','2020-01-01T00:00:00Z','reported');
SQL
 count="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c 'SELECT COUNT(*) FROM ticket')"
 test "$count" = 3 || { echo "A143_HISTORICAL_ROWS_MISMATCH";exit 1; }
 stop_app
 node packages/cli/protocolia.mjs plan examples/vnext/facility-maintenance-a143 "$folder"
 node packages/cli/protocolia.mjs evolve examples/vnext/facility-maintenance-a143 "$folder"
 if [[ "$target" == spring ]];then
  cmp "/work/dist/a143-old-$target/src/main/resources/db/migration/V1__contract_baseline.sql" \
    "$folder/src/main/resources/db/migration/V1__contract_baseline.sql"
  patch="$folder/src/main/resources/db/migration/V2__protocolia_additive.sql"
 else
  cmp "/work/dist/a143-old-$target/src/schema.sql" "$folder/src/schema.sql"
  patch="$folder/src/migrations/V2__protocolia_additive.sql"
 fi
 grep -q 'CREATE TABLE protocolia_notification_outbox' "$patch"
 grep -q 'CREATE TABLE protocolia_identity_technician' "$patch"
 start_app "$target" "$db" "$folder" true
 node scripts/vnext/probe-a14-evolution-http.mjs verify
 gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" <<'SQL' >/tmp/a143-bind.log
INSERT INTO protocolia_identity_technician(issuer,subject,recipient_key)
VALUES ('demo-basic','reader','TE-OLD'),('demo-basic','manager','TE-NEW');
SQL
 ready=0
 for i in $(seq 1 40);do
  count="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c 'SELECT COUNT(*) FROM protocolia_notification_inbox')"
  if [[ "$count" == 2 ]];then ready=1;break;fi
  sleep 1
 done
 test "$ready" = 1 || { echo "A143_WORKER_DID_NOT_DELIVER";exit 1; }
 node --input-type=module <<'JS'
import assert from "node:assert/strict";
const base="http://127.0.0.1:8080/api/notifications/technician";
async function req(user,path="",method="GET"){
 const pw=user==="reader"?process.env.PROTOCOLIA_READER_PASSWORD:process.env.PROTOCOLIA_MANAGER_PASSWORD;
 const r=await fetch(base+path,{method,headers:{Authorization:"Basic "+Buffer.from(user+":"+pw).toString("base64")}});
 return {code:r.status,body:await r.json().catch(()=>null)};
}
const reader=await req("reader"),manager=await req("manager");
assert.equal(reader.code,200);assert.equal(manager.code,200);
assert.equal(reader.body.total,1);assert.equal(manager.body.total,1);
assert.equal(reader.body.items[0].resourceId,"TK-ALERT-OLD");
assert.equal(manager.body.items[0].resourceId,"TK-ALERT-NEW");
const theirs=reader.body.items[0].id,ours=manager.body.items[0].id;
assert.equal((await req("reader","/"+theirs+"/ack","POST")).code,403);
assert.equal((await req("manager","/"+theirs+"/ack","POST")).code,404);
const ack=await req("manager","/"+ours+"/ack","POST");
assert.equal(ack.code,200);assert.ok(ack.body.readAt);
assert.equal((await req("manager","/"+ours+"/ack","POST")).body.readAt,ack.body.readAt);
JS
 stop_app
 start_app "$target" "$db" "$folder" true
 stored="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT (SELECT COUNT(*) FROM ticket)||':'||(SELECT COUNT(*) FROM protocolia_notification_inbox)||':'||(SELECT COUNT(*) FROM protocolia_notification_inbox WHERE read_at IS NOT NULL)")"
 test "$stored" = "3:2:1" || { echo "A143_RESTART_LOST_DATA $stored";exit 1; }
 node packages/cli/protocolia.mjs evolve examples/vnext/facility-maintenance-a143 "$folder" >/tmp/a143-repeat.log
 grep -q PROTOCOLIA_EVOLUTION_NO_CHANGES /tmp/a143-repeat.log
 stop_app
 echo "A143_$target"_IN_PLACE_UPGRADE_ROWS_AUDIT_INBOX_ACK_RESTART_PASS
done
echo A143_BOTH_TARGETS_IN_PLACE_NOTIFICATION_EVOLUTION_PASS
