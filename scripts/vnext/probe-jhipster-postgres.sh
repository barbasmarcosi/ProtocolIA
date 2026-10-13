#!/usr/bin/env bash
set -euo pipefail
echo "A0_POSTGRES_16_PROBE_START"
mkdir -p /tmp/a0-pg16
chown -R postgres:postgres /tmp/a0-pg16
gosu postgres initdb -D /tmp/a0-pg16 --auth-local=trust --auth-host=trust >/tmp/a0-initdb.log
gosu postgres pg_ctl -D /tmp/a0-pg16 -o "-c listen_addresses=127.0.0.1" -l /tmp/a0-postgres.log start
spring_pid=""
cleanup() {
  if [ -n "$spring_pid" ]; then kill "$spring_pid" 2>/dev/null || true; wait "$spring_pid" 2>/dev/null || true; fi
  gosu postgres pg_ctl -D /tmp/a0-pg16 stop -m immediate >/dev/null 2>&1 || true
  rm -rf /tmp/a0-pg16
}
trap cleanup EXIT
gosu postgres createdb -h 127.0.0.1 protocolia_a0
jar="$(find /work/dist/jhipster/target -maxdepth 1 -name '*.jar' ! -name '*.original' | head -n 1)"
test -n "$jar"
SPRING_PROFILES_ACTIVE=dev \
SPRING_DOCKER_COMPOSE_ENABLED=false \
SPRING_DATASOURCE_URL=jdbc:postgresql://127.0.0.1:5432/protocolia_a0 \
SPRING_DATASOURCE_USERNAME=postgres \
SPRING_DATASOURCE_PASSWORD=postgres \
SERVER_PORT=8080 \
java -jar "$jar" >/tmp/a0-spring.log 2>&1 &
spring_pid=$!
ready=0
for i in $(seq 1 120); do
  http="$(curl --max-time 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/management/health || true)"
  if [ "$http" = "200" ]; then ready=1; break; fi
  if ! kill -0 "$spring_pid" 2>/dev/null; then break; fi
  sleep 2
done
if [ "$ready" != 1 ]; then
  echo "A0_SPRING_HEALTH_UNAVAILABLE"
  tail -n 90 /tmp/a0-spring.log
  exit 1
fi
echo "A0_SPRING_HEALTH_200"
node scripts/vnext/probe-jhipster-http.mjs || { tail -n 80 /tmp/a0-spring.log; exit 1; }
echo "A0_POSTGRES_TOOL_ROWS"
gosu postgres psql -h 127.0.0.1 -d protocolia_a0 -t -c 'SELECT count(*) FROM tool;'
echo "A0_POSTGRES_REAL_HTTP_PROBE_PASS"
