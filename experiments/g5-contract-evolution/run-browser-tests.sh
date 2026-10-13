#!/usr/bin/env bash
set -euo pipefail
install -d -m 0700 -o postgres -g postgres /tmp/g5-browser-db
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/g5-browser-db -A trust --no-instructions" >/tmp/g5-browser-init.log
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/g5-browser-db -o '-c listen_addresses=127.0.0.1 -p 55432' -l /tmp/g5-browser-pg.log start"
trap 'su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/g5-browser-db -m immediate stop" || true' EXIT
su postgres -c "createdb -h 127.0.0.1 -p 55432 books_test"
export G5_JDBC_URL=jdbc:postgresql://127.0.0.1:55432/books_test
export G5_DB_USER=postgres
export G5_DB_PASSWORD=''
bash ./run-g3-browser-tests.sh
echo G5_V04_REAL_CHROMIUM_RJSF_POSTGRES_E2E_PASS
