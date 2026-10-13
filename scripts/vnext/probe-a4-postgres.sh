#!/usr/bin/env bash
set -euo pipefail
mkdir -p /tmp/a4-relations-pg
chown -R postgres:postgres /tmp/a4-relations-pg
gosu postgres initdb -D /tmp/a4-relations-pg --auth-local=trust --auth-host=trust >/tmp/a4-relations-initdb.log
gosu postgres pg_ctl -D /tmp/a4-relations-pg -o "-c listen_addresses=127.0.0.1" -l /tmp/a4-relations-postgres.log start
pid=""
cleanup() {
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  gosu postgres pg_ctl -D /tmp/a4-relations-pg stop -m immediate >/dev/null 2>&1 || true
  rm -rf /tmp/a4-relations-pg
}
trap cleanup EXIT
gosu postgres createdb -h 127.0.0.1 protocolia_a4
PROTOCOLIA_ALLOW_DEMO_AUTH=true \
PROTOCOLIA_READER_USERNAME=reader \
PROTOCOLIA_READER_PASSWORD=test-reader-only-2026 \
PROTOCOLIA_MANAGER_USERNAME=manager \
PROTOCOLIA_MANAGER_PASSWORD=test-manager-only-2026 \
PROTOCOLIA_JDBC_URL=jdbc:postgresql://127.0.0.1:5432/protocolia_a4 \
PROTOCOLIA_JDBC_USER=postgres \
PROTOCOLIA_JDBC_PASSWORD=postgres \
PORT=8080 \
java -jar /work/dist/relations/target/modular-generated-0.0.1.jar > /tmp/a4-relations-spring.log 2>&1 &
pid=$!
ready=0
for i in $(seq 1 90); do
  http="$(curl --max-time 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)"
  if [ "$http" = "200" ]; then ready=1; break; fi
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  sleep 2
done
if [ "$ready" != 1 ]; then
  echo "A4_MODULAR_BOOT_FAILED"
  tail -n 100 /tmp/a4-relations-spring.log
  exit 1
fi
echo "A4_HEALTH_200"
node scripts/vnext/probe-a4-http.mjs || { tail -n 90 /tmp/a4-relations-spring.log; exit 1; }
node scripts/vnext/probe-a4-browser.mjs || { tail -n 90 /tmp/a4-relations-spring.log; exit 1; }
if [[ "${A4_VARIANT:-false}" == "true" ]]; then
  node scripts/vnext/probe-a4-evolution-http.mjs || { tail -n 90 /tmp/a4-relations-spring.log; exit 1; }
fi
node scripts/vnext/probe-a4-cleanup.mjs || { tail -n 90 /tmp/a4-relations-spring.log; exit 1; }
gosu postgres psql -h 127.0.0.1 -d protocolia_a4 -t -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('equipment','inspection') ORDER BY table_name;"
gosu postgres psql -h 127.0.0.1 -d protocolia_a4 -t -c "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY' AND table_name='inspection';"

echo "A4_REAL_POSTGRES_BROWSER_FK_CONFORMANCE_PASS"
