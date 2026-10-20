#!/usr/bin/env bash
set -euo pipefail
cd /work
export PROTOCOLIA_ALLOW_DEMO_AUTH=true
export PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_MANAGER_USERNAME=manager
export PROTOCOLIA_READER_PASSWORD=local-worker-read
export PROTOCOLIA_MANAGER_PASSWORD=local-worker-write
DATA=/tmp/a143-worker-db
rm -rf "$DATA"
mkdir -p "$DATA"
chown postgres:postgres "$DATA"
gosu postgres initdb -D "$DATA" --auth-local=trust --auth-host=trust >/tmp/a143-worker-init.log
gosu postgres pg_ctl -D "$DATA" -o "-c listen_addresses=127.0.0.1" \
  -l /tmp/a143-worker-pg.log start >/dev/null
pid=""
stop_app(){
 if [[ -n "$pid" ]];then
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  pid=""
 fi
}
cleanup(){
 stop_app
 gosu postgres pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
 rm -rf "$DATA"
}
trap cleanup EXIT
start_app(){
 local target="$1" db="$2" enabled="$3" root="/work/dist/a143-$1-app"
 if [[ "$target" == spring ]]; then
  PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$db" \
  PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
  PROTOCOLIA_ALERT_WORKER_ENABLED="$enabled" \
  PROTOCOLIA_ALERT_INTERVAL_MS=1000 PROTOCOLIA_ALERT_INITIAL_DELAY_MS=1000 \
  PORT=8080 java -jar "$root/target/modular-generated-0.0.1.jar" \
    >/tmp/a143-$target-worker.log 2>&1 &
 else
  (
   cd "$root"
   PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
   PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=unused \
   PROTOCOLIA_ALERT_WORKER_ENABLED="$enabled" PROTOCOLIA_ALERT_INTERVAL_MS=1000 \
   PORT=8080 node dist/main.js
  ) >/tmp/a143-$target-worker.log 2>&1 &
 fi
 pid=$!
 local ready=0
 for i in $(seq 1 90);do
  if [[ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)" == 200 ]];then
   ready=1;break
  fi
  if ! kill -0 "$pid" 2>/dev/null;then break;fi
  sleep 1
 done
 if [[ "$ready" != 1 ]];then
   tail -n 100 /tmp/a143-"$target"-worker.log
   exit 1
 fi
}
for target in spring nest; do
 db="a143_worker_$target"
 gosu postgres createdb -h 127.0.0.1 "$db"
 start_app "$target" "$db" false
 gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" <<'SQL' >/tmp/a143-worker-seed.log
INSERT INTO site (code,name,address) VALUES ('S','Main','Main St');
INSERT INTO machine (tag,site_code,name,category) VALUES ('M','S','Pump','hydraulic');
INSERT INTO technician (badge,name,skill) VALUES ('T','Engineer','engine');
INSERT INTO ticket (number,machine_tag,technician_badge,title,severity,due_at,status)
VALUES ('WORKER-PAST','M','T','Past due','high','2001-01-01T00:00:00Z','reported'),
       ('WORKER-FUTURE','M','T','Not due','low','2099-01-01T00:00:00Z','reported'),
       ('WORKER-DONE','M','T','Completed','low','2001-01-01T00:00:00Z','completed');
SQL
 sleep 3
 count="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
   'SELECT COUNT(*) FROM protocolia_notification_outbox')"
 test "$count" = 0 || { echo "A143_WORKER_UNAUTHORIZED_AUTOSTART $target";exit 1; }
 stop_app
 start_app "$target" "$db" true
 ready=0
 for i in $(seq 1 45);do
  count="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
    "SELECT COUNT(*) FROM protocolia_notification_inbox WHERE resource_id='WORKER-PAST'")"
  if [[ "$count" = 1 ]];then ready=1;break;fi
  sleep 1
 done
 if [[ "$ready" != 1 ]];then
  tail -n 100 /tmp/a143-"$target"-worker.log
  exit 1
 fi
 grep -q 'PROTOCOLIA_ALERT_TICK' /tmp/a143-"$target"-worker.log || {
   echo "A143_WORKER_NO_TICK_LOG $target";exit 1;
 }
 stop_app
 start_app "$target" "$db" true
 sleep 3
 state="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
   "SELECT (SELECT COUNT(*) FROM protocolia_notification_outbox)||':'||(SELECT COUNT(*) FROM protocolia_notification_inbox)")"
 test "$state" = '1:1' || { echo "A143_WORKER_DUPLICATE_AFTER_RESTART $target $state";exit 1; }
 echo "A143_$target"_OPT_IN_AUTOMATIC_WORKER_POSTGRES_RESTART_PASS
 node scripts/vnext/probe-a143-recipient-http.mjs unbound
 gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
INSERT INTO technician (badge,name,skill) VALUES ('U','Second recipient','other');
INSERT INTO protocolia_identity_technician(issuer,subject,recipient_key)
 VALUES ('demo-basic','manager','T'),('demo-basic','reader','U');
INSERT INTO ticket(number,machine_tag,technician_badge,title,severity,due_at,status)
 SELECT 'NOTICE-'||n,'M','T','Due task','high','2001-01-01T00:00:00Z','reported' FROM generate_series(1,12) n;
INSERT INTO ticket(number,machine_tag,technician_badge,title,severity,due_at,status)
 VALUES ('READER-ONLY','M','U','Private other notice','high','2001-01-01T00:00:00Z','reported');
SELECT * FROM protocolia_tick_notifications(CURRENT_TIMESTAMP,100);
DO $test$
BEGIN
 BEGIN
  PERFORM protocolia_inbox_technician_page('wrong-issuer','manager',25,0);
  RAISE EXCEPTION 'Issuer confusion';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO protocolia_identity_technician(issuer,subject,recipient_key) VALUES ('demo-basic','forged','MISSING');
  RAISE EXCEPTION 'Missing FK validation';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO protocolia_identity_technician(issuer,subject,recipient_key) VALUES ('demo-basic','manager','U');
  RAISE EXCEPTION 'Ambiguous binding accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  PERFORM protocolia_inbox_technician_ack('demo-basic','manager',
   (SELECT outbox_id FROM protocolia_notification_inbox WHERE recipient_key='U'));
  RAISE EXCEPTION 'Cross-recipient database ack allowed';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 IF (SELECT read_at FROM protocolia_notification_inbox WHERE recipient_key='U') IS NOT NULL THEN
  RAISE EXCEPTION 'Cross-recipient mutation'; END IF;
END $test$;
SQL
 node scripts/vnext/probe-a143-recipient-http.mjs bound
 node scripts/vnext/probe-a143-recipient-browser.mjs
 stop_app
 start_app "$target" "$db" false
 node scripts/vnext/probe-a143-recipient-http.mjs restart
 echo "A143_$target"_RECIPIENT_HTTP_POSTGRES_CHROMIUM_RESTART_PASS
 stop_app
done
echo A143_BOTH_TARGETS_OPT_IN_WORKER_COMPILED_HTTP_PG_PASS
