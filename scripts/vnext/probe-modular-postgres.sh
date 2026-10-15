#!/usr/bin/env bash
set -euo pipefail
mkdir -p /tmp/a0-modular-pg
chown -R postgres:postgres /tmp/a0-modular-pg
gosu postgres initdb -D /tmp/a0-modular-pg --auth-local=trust --auth-host=trust >/tmp/a0-modular-initdb.log
gosu postgres pg_ctl -D /tmp/a0-modular-pg -o "-c listen_addresses=127.0.0.1" -l /tmp/a0-modular-postgres.log start
pid=""
cleanup() {
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  gosu postgres pg_ctl -D /tmp/a0-modular-pg stop -m immediate >/dev/null 2>&1 || true
  rm -rf /tmp/a0-modular-pg
}
trap cleanup EXIT
gosu postgres createdb -h 127.0.0.1 protocolia_modular
PROTOCOLIA_ALLOW_DEMO_AUTH=true \
PROTOCOLIA_READER_USERNAME=reader \
PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
PROTOCOLIA_MANAGER_USERNAME=manager \
PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
PROTOCOLIA_JDBC_URL=jdbc:postgresql://127.0.0.1:5432/protocolia_modular \
PROTOCOLIA_JDBC_USER=postgres \
PROTOCOLIA_JDBC_PASSWORD=postgres \
PORT=8080 \
java -jar /work/dist/modular/target/modular-generated-0.0.1.jar > /tmp/a0-modular-spring.log 2>&1 &
pid=$!
ready=0
for i in $(seq 1 90); do
  http="$(curl --max-time 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)"
  if [ "$http" = "200" ]; then ready=1; break; fi
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  sleep 2
done
if [ "$ready" != 1 ]; then
  echo "A0_MODULAR_BOOT_FAILED"
  tail -n 100 /tmp/a0-modular-spring.log
  exit 1
fi
echo "A0_MODULAR_HEALTH_200"
node scripts/vnext/probe-modular-http.mjs || { tail -n 90 /tmp/a0-modular-spring.log; exit 1; }
node scripts/vnext/probe-modular-browser.mjs || { tail -n 90 /tmp/a0-modular-spring.log; exit 1; }
PROTOCOLIA_ALLOW_CONFORMANCE_WRITES=true \
PROTOCOLIA_MANAGER_USERNAME=manager PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
PROTOCOLIA_READER_USERNAME=reader PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
node packages/cli/conformance.mjs /work/dist/modular http://127.0.0.1:8080 || { tail -n 90 /tmp/a0-modular-spring.log; exit 1; }
gosu postgres psql -h 127.0.0.1 -d protocolia_modular -t -c 'SELECT code,name,quantity FROM tool ORDER BY code;'
echo "A0_MODULAR_REAL_POSTGRES_CONFORMANCE_PASS"

bash scripts/vnext/probe-flyway-lifecycle.sh "$pid" protocolia_modular \
  "/work/dist/modular/target/modular-generated-0.0.1.jar" \
  "/work/dist/modular/src/main/resources/db/migration/V1__contract_baseline.sql" \
  "/api/tools/A0-MODULAR-001" quantity 17
