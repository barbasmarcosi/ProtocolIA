#!/usr/bin/env bash
set -euo pipefail
: "${PROTOCOLIA_USER:?Missing test username}"
: "${PROTOCOLIA_PASSWORD:?Missing test password}"
: "${PROTOCOLIA_SCOPES:?Missing test scopes}"
: "${PROTOCOLIA_VIEWER_USER:?Missing viewer username}"
: "${PROTOCOLIA_VIEWER_PASSWORD:?Missing viewer password}"
data="${TALLER_PGDATA:-/tmp/taller-pgdata}"
install -d -m 0700 -o postgres -g postgres "$data"
if [ ! -f "$data/PG_VERSION" ]; then
  su postgres -s /bin/sh -c "/usr/lib/postgresql/16/bin/initdb -D '$data' -A trust --no-instructions" >/tmp/taller-init.log
fi
su postgres -s /bin/sh -c "/usr/lib/postgresql/16/bin/pg_ctl -D '$data' -o '-c listen_addresses=127.0.0.1 -p 55439 -c shared_buffers=16MB -c max_connections=16' -l /tmp/taller-postgres.log start" || {
 cat /tmp/taller-postgres.log; exit 1;
}
trap 'su postgres -s /bin/sh -c "/usr/lib/postgresql/16/bin/pg_ctl -D '\'''"$data"'\'' -m immediate stop" >/dev/null 2>&1 || true' EXIT
if ! su postgres -s /bin/sh -c "psql -h 127.0.0.1 -p 55439 -d postgres -Atc \"SELECT 1 FROM pg_database WHERE datname='tools_demo'\"" | grep -qx 1; then
  su postgres -s /bin/sh -c "createdb -h 127.0.0.1 -p 55439 tools_demo"
fi
echo "TALLER_POSTGRES_READY; starting Spring Boot on PORT=${PORT:-10000}"
exec /opt/java/openjdk/bin/java -Xms48m -Xmx256m -jar /app/taller.jar
