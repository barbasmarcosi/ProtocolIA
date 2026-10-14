#!/usr/bin/env bash
set -euo pipefail
cd /work
DATA=/tmp/a143-pg
rm -rf "$DATA"
mkdir -p "$DATA"
chown postgres:postgres "$DATA"
gosu postgres initdb -D "$DATA" --auth-local=trust --auth-host=trust >/tmp/a143-init.log
cleanup(){
 gosu postgres pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
 rm -rf "$DATA"
}
trap cleanup EXIT
gosu postgres pg_ctl -D "$DATA" -o "-c listen_addresses=127.0.0.1" -l /tmp/a143-pg.log start >/dev/null
for target in spring nest; do
 db="a143_$target"
 gosu postgres createdb -h 127.0.0.1 "$db"
 if [[ "$target" == spring ]]; then
  sql="/work/dist/a143-spring/src/main/resources/db/migration/V1__contract_baseline.sql"
 else
  sql="/work/dist/a143-nest/src/schema.sql"
 fi
 gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" -f "$sql" >/tmp/a143-schema.log
 gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" <<'SQL' >/tmp/a143-seed.log
INSERT INTO site (code,name,address) VALUES ('S','Main','Street 1');
INSERT INTO machine (tag,site_code,name,category) VALUES ('M','S','Pump','hydraulic');
INSERT INTO technician (badge,name,skill) VALUES ('T','Alex','engine');
INSERT INTO ticket (number,machine_tag,technician_badge,title,severity,due_at,status)
VALUES
 ('TK-PAST','M','T','Repair','high','2026-10-20T12:00:00Z','reported'),
 ('TK-FUTURE','M','T','Inspection','low','2026-10-23T12:00:00Z','reported'),
 ('TK-DONE','M','T','Complete','low','2026-10-19T12:00:00Z','completed');
SQL
 asof="'2026-10-22T00:00:00Z'::timestamptz"
 first="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT protocolia_materialize_ticket_overdue($asof)")"
 test "$first" = 1 || { echo "A143_INSERT_COUNT_MISMATCH $target: $first";exit 1; }
 again="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT protocolia_materialize_ticket_overdue($asof)")"
 test "$again" = 0 || { echo "A143_NOT_IDEMPOTENT $target: $again";exit 1; }
 matched="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT rule_key||':'||resource_id||':'||recipient_key||':'||status FROM protocolia_notification_outbox")"
 test "$matched" = 'Ticket.overdue:TK-PAST:T:pending' || { echo "A143_WRONG_RECIPIENT_OR_STATUS $matched";exit 1; }
 count="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT COUNT(*) FROM protocolia_notification_outbox")"
 test "$count" = 1 || { echo "A143_DUPLICATE_NOTICES $count";exit 1; }
 echo "A143_$target"_PG_TIME_BOUND_DEDUP_RECIPIENT_AND_TERMINAL_EXCLUSION_PASS
done
gosu postgres pg_ctl -D "$DATA" stop -m immediate >/dev/null
gosu postgres pg_ctl -D "$DATA" -o "-c listen_addresses=127.0.0.1" -l /tmp/a143-restart.log start >/dev/null
for target in spring nest; do
 db="a143_$target"
 persisted="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT COUNT(*) FROM protocolia_notification_outbox WHERE resource_id='TK-PAST' AND status='pending'")"
 test "$persisted" = 1 || { echo "A143_LOST_AFTER_RESTART $target";exit 1; }
done
echo A143_BOTH_TARGETS_PERSISTED_INBOX_AFTER_POSTGRES_RESTART_PASS

# S2a: a broken inbox insert must roll back the event status and attempts.
for target in spring nest; do
 db="a143_$target"
 gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" <<'SQL' >/tmp/a143-trigger.log
CREATE FUNCTION protocolia_fail_inbox_insert() RETURNS trigger LANGUAGE plpgsql AS $
BEGIN RAISE EXCEPTION 'simulated inbox write failure'; END;
$;
CREATE TRIGGER protocolia_test_failure BEFORE INSERT ON protocolia_notification_inbox
FOR EACH ROW EXECUTE FUNCTION protocolia_fail_inbox_insert();
SQL
 if gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" -At \
    -c 'SELECT protocolia_dispatch_inbox(10)' >/tmp/a143-reject.log 2>&1; then
  echo "A143_DISPATCH_FAILED_TO_ROLLBACK $target";exit 1
 fi
 snapshot="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT (SELECT COUNT(*) FROM protocolia_notification_inbox)||':'||(SELECT status||':'||attempts FROM protocolia_notification_outbox LIMIT 1)")"
 test "$snapshot" = '0:pending:0' || { echo "A143_DISPATCH_PARTIAL_COMMIT $target: $snapshot";exit 1; }
 gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" -c \
    'DROP TRIGGER protocolia_test_failure ON protocolia_notification_inbox; DROP FUNCTION protocolia_fail_inbox_insert();' >/dev/null
 # Two independent database clients race on the same pending event. Only one
 # can commit its receipt, and the other must return zero without blocking.
 a="$(mktemp)";b="$(mktemp)"
 gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" -At \
   -c 'SELECT protocolia_dispatch_inbox(1)' >"$a" & apid=$!
 gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" -At \
   -c 'SELECT protocolia_dispatch_inbox(1)' >"$b" & bpid=$!
 wait "$apid";wait "$bpid"
 first="$(cat "$a")"; second="$(cat "$b")";rm -f "$a" "$b"
 test "$((first+second))" = 1 || { echo "A143_CONCURRENT_DOUBLE_DISPATCH $target";exit 1; }
 receipt="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT (SELECT COUNT(*) FROM protocolia_notification_inbox)||':'||(SELECT status||':'||attempts FROM protocolia_notification_outbox LIMIT 1)")"
 test "$receipt" = '1:delivered:1' || { echo "A143_RECEIPT_MISMATCH $target $receipt";exit 1; }
 again="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c 'SELECT protocolia_dispatch_inbox(10)')"
 test "$again" = 0 || { echo "A143_DISPATCH_NOT_IDEMPOTENT $target";exit 1; }
 if gosu postgres psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -d "$db" -At \
    -c 'SELECT protocolia_dispatch_inbox(0)' >/dev/null 2>&1; then
  echo "A143_UNBOUNDED_BATCH_ALLOWED $target";exit 1
 fi
 echo "A143_$target"_ATOMIC_INBOX_CONCURRENT_IDEMPOTENT_RECEIPT_PASS
done
gosu postgres pg_ctl -D "$DATA" stop -m immediate >/dev/null
gosu postgres pg_ctl -D "$DATA" -o "-c listen_addresses=127.0.0.1" -l /tmp/a143-inbox-restart.log start >/dev/null
for target in spring nest; do
 db="a143_$target"
 receipt="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c 'SELECT COUNT(*) FROM protocolia_notification_inbox')"
 test "$receipt" = 1 || { echo "A143_INBOX_RECEIPT_LOST_AFTER_RESTART $target";exit 1; }
done
echo A143_BOTH_TARGETS_DELIVERED_INBOX_SURVIVES_PG_RESTART_PASS
