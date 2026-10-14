#!/usr/bin/env bash
set -euo pipefail
PGDIR=/tmp/protocolia-workflow-pg
mkdir -p "$PGDIR"
chown -R postgres:postgres "$PGDIR"
gosu postgres initdb -D "$PGDIR" --auth-local=trust --auth-host=trust >/tmp/workflow-initdb.log
gosu postgres pg_ctl -D "$PGDIR" -o "-c listen_addresses=127.0.0.1" -l /tmp/workflow-postgres.log start >/dev/null
pid=""
stop_app(){ if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; pid=""; fi; }
cleanup(){ stop_app; gosu postgres pg_ctl -D "$PGDIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$PGDIR"; }
trap cleanup EXIT
for target in spring nest; do
  db="protocolia_workflow_$target"
  gosu postgres createdb -h 127.0.0.1 "$db"
  if [[ "$target" == spring ]]; then
    PROTOCOLIA_ALLOW_DEMO_AUTH=true \
    PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
    PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
    PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$db" \
    PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
    PORT=8080 java -jar /work/dist/workflow-spring/target/modular-generated-0.0.1.jar > "/tmp/workflow-$target.log" 2>&1 &
  else
    (
      cd /work/dist/workflow-nest
      PROTOCOLIA_ALLOW_DEMO_AUTH=true \
      PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
      PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
      PROTOCOLIA_JDBC_URL="postgresql://127.0.0.1:5432/$db" \
      PROTOCOLIA_JDBC_USER=postgres PROTOCOLIA_JDBC_PASSWORD=postgres \
      PORT=8080 node dist/main.js
    ) > "/tmp/workflow-$target.log" 2>&1 &
  fi
  pid="$!"
  ready=0
  for i in $(seq 1 75); do
    code="$(curl --max-time 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)"
    if [[ "$code" == "200" ]]; then ready=1; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if [[ "$ready" != "1" ]]; then tail -n 100 "/tmp/workflow-$target.log"; exit 1; fi
  node scripts/vnext/probe-workflow-http.mjs || { tail -n 100 "/tmp/workflow-$target.log"; exit 1; }
  PROTOCOLIA_ALLOW_CONFORMANCE_WRITES=true \
  PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
  PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
  node packages/cli/conformance.mjs "/work/dist/workflow-$target" http://127.0.0.1:8080 \
    || { tail -n 100 "/tmp/workflow-$target.log"; exit 1; }
  gosu postgres psql -h 127.0.0.1 -d "$db" -At -c "SELECT status FROM work_order WHERE code='W-001'" | grep -qx closed
  if gosu postgres psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -d "$db" -c     "INSERT INTO work_order (code,title,status) VALUES ('W-ROGUE','db bypass','unapproved');" > /tmp/workflow-bypass.log 2>&1; then
    echo A6_DATABASE_STATE_CHECK_BYPASSED
    exit 1
  fi
  grep -q 'check constraint' /tmp/workflow-bypass.log
  echo "A6_${target}_GUARDED_WORKFLOW_POSTGRES_HTTP_PASS"
  audit_rows="$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
    "SELECT string_agg(operation_name||':'||field_name||':'||COALESCE(before_value,'NULL')||'->'||after_value,',' ORDER BY id) FROM protocolia_audit_event WHERE entity_name='WorkOrder' AND resource_id='W-001'")"
  expected="createWorkOrder:title:NULL->Inspect machine,createWorkOrder:status:NULL->draft,approveWorkOrder:status:draft->approved,closeWorkOrder:status:approved->closed"
  test "$audit_rows" = "$expected" || { echo "A10_UNEXPECTED_JOURNAL $audit_rows"; exit 1; }
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
    "SELECT count(*) FROM protocolia_audit_event WHERE resource_id='W-001' AND actor='manager' AND occurred_at IS NOT NULL")" = 4
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
    "SELECT count(*) FROM protocolia_audit_event WHERE resource_id IN ('W-BAD','W-BAD-2','W-MISSING','W-DENY')")" = 0
  echo "A10_${target}_IMMUTABLE_AUTHENTICATED_AUDIT_SEQUENCE_PASS"
  gosu postgres psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -d "$db" <<'SQL' >/tmp/a10-fault.log
CREATE FUNCTION protocolia_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $audit$
BEGIN RAISE EXCEPTION 'A10 intentional audit insert failure'; END;
$audit$;
CREATE TRIGGER protocolia_fault_audit BEFORE INSERT ON protocolia_audit_event
FOR EACH ROW EXECUTE FUNCTION protocolia_fail_audit();
SQL
  node scripts/vnext/probe-a10-audit-failure.mjs create
  gosu postgres psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -d "$db" -c \
    "DROP TRIGGER protocolia_fault_audit ON protocolia_audit_event;" >/dev/null
  node --input-type=module -e '
    const actor="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
    const res=await fetch("http://127.0.0.1:8080/api/work-orders",{
      method:"POST",headers:{Authorization:actor,"Content-Type":"application/json"},
      body:JSON.stringify({code:"W-AUDFAIL",title:"Audit rollback fixture",status:"draft"})
    });
    if(res.status!==201)throw Error("Audit fault recovery create "+res.status);'
  gosu postgres psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -d "$db" -c \
    "CREATE TRIGGER protocolia_fault_audit BEFORE INSERT ON protocolia_audit_event FOR EACH ROW EXECUTE FUNCTION protocolia_fail_audit();" >/dev/null
  node scripts/vnext/probe-a10-audit-failure.mjs transition
  gosu postgres psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -d "$db" -c \
    "DROP TRIGGER protocolia_fault_audit ON protocolia_audit_event;" >/dev/null
  test "$(gosu postgres psql -h 127.0.0.1 -d "$db" -At -c \
    "SELECT count(*) FROM protocolia_audit_event WHERE resource_id='W-AUDFAIL'")" = 2
  echo "A10_${target}_AUDIT_FAILURE_ATOMIC_ROLLBACK_PASS"
  stop_app
done
