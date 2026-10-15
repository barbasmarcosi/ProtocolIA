#!/usr/bin/env bash
# Runs after successful original HTTP/browser suite; uses the SAME disposable PostgreSQL database.
set -euo pipefail
original_pid="$1"
database="$2"
jar="$3"
baseline="$4"
route="$5"
field="$6"
expected="$7"
echo "A1_FLYWAY_LIFECYCLE_BEGIN database=$database"
history="$(gosu postgres psql -h 127.0.0.1 -d "$database" -tA -c "SELECT COUNT(*) FROM flyway_schema_history WHERE version='1' AND success=true")"
test "$history" = "1" || { echo "A1_FLYWAY_HISTORY_MISSING=$history"; exit 1; }
echo "A1_FLYWAY_V1_APPLIED_ONCE_PASS"
kill "$original_pid"
# Wait for the original JVM to release the HTTP port (its PID is not our child).
for i in $(seq 1 40); do
  if ! kill -0 "$original_pid" 2>/dev/null; then break; fi
  sleep 0.25
done
run_pid=""
stop_current() {
  if [[ -n "$run_pid" ]]; then kill "$run_pid" 2>/dev/null || true; wait "$run_pid" 2>/dev/null || true; fi
}
trap stop_current EXIT
start_again() {
  PROTOCOLIA_ALLOW_DEMO_AUTH=true \
  PROTOCOLIA_READER_USERNAME=reader \
  PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
  PROTOCOLIA_MANAGER_USERNAME=manager \
  PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
  PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$database" \
  PROTOCOLIA_JDBC_USER=postgres \
  PROTOCOLIA_JDBC_PASSWORD=postgres \
  PORT=8080 \
  java -jar "$jar" > /tmp/a1-flyway-restart.log 2>&1 &
  run_pid="$!"
}
start_again
ready=0
for i in $(seq 1 60); do
  code="$(curl --max-time 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)"
  if [[ "$code" = "200" ]]; then ready=1; break; fi
  if ! kill -0 "$run_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then tail -n 80 /tmp/a1-flyway-restart.log; exit 1; fi
PROTOCOLIA_LIFECYCLE_ROUTE="$route" PROTOCOLIA_LIFECYCLE_FIELD="$field" PROTOCOLIA_LIFECYCLE_EXPECTED="$expected" \
node --input-type=module -e '
  const url="http://127.0.0.1:8080"+process.env.PROTOCOLIA_LIFECYCLE_ROUTE;
  const token=Buffer.from("reader:test-reader-only-2026").toString("base64");
  const response=await fetch(url,{headers:{Authorization:"Basic "+token}});
  if(response.status!==200)throw Error("Restarted runtime GET "+response.status);
  const data=await response.json();
  if(data[process.env.PROTOCOLIA_LIFECYCLE_FIELD]!==Number(process.env.PROTOCOLIA_LIFECYCLE_EXPECTED))
    throw Error("Lost DB row across restart: "+JSON.stringify(data));
'
echo "A1_FLYWAY_SECOND_JVM_PRESERVES_ROWS_PASS"
stop_current
run_pid=""
mkdir -p /tmp/a1-flyway-mutated
cp "$baseline" /tmp/a1-flyway-mutated/V1__contract_baseline.sql
# This harmless extra statement alters an already-applied V1 checksum; must NEVER be executed.
printf '\nSELECT 1;\n' >> /tmp/a1-flyway-mutated/V1__contract_baseline.sql
PROTOCOLIA_ALLOW_DEMO_AUTH=true \
PROTOCOLIA_READER_USERNAME=reader \
PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
PROTOCOLIA_MANAGER_USERNAME=manager \
PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
PROTOCOLIA_JDBC_URL="jdbc:postgresql://127.0.0.1:5432/$database" \
PROTOCOLIA_JDBC_USER=postgres \
PROTOCOLIA_JDBC_PASSWORD=postgres \
SPRING_FLYWAY_LOCATIONS=filesystem:/tmp/a1-flyway-mutated \
PORT=8080 java -jar "$jar" > /tmp/a1-flyway-drift.log 2>&1 &
run_pid="$!"
for i in $(seq 1 60); do
  if ! kill -0 "$run_pid" 2>/dev/null; then break; fi
  sleep 0.5
done
if kill -0 "$run_pid" 2>/dev/null; then
  echo "A1_FLYWAY_DRIFT_UNEXPECTED_STARTUP"; tail -n 80 /tmp/a1-flyway-drift.log; exit 1
fi
if ! grep -Eiq 'checksum mismatch|Validate failed|Migration checksum' /tmp/a1-flyway-drift.log; then
  echo "A1_FLYWAY_DRIFT_FAILED_FOR_WRONG_REASON"; tail -n 80 /tmp/a1-flyway-drift.log; exit 1
fi
run_pid=""
history2="$(gosu postgres psql -h 127.0.0.1 -d "$database" -tA -c "SELECT COUNT(*) FROM flyway_schema_history WHERE version='1' AND success=true")"
test "$history2" = "1"
echo "A1_FLYWAY_MODIFIED_BASELINE_REFUSED_PASS"
