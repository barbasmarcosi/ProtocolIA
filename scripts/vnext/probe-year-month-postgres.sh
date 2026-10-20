#!/usr/bin/env bash
# Verify a generated migration against real PostgreSQL, including rejected legacy data.
set -euo pipefail
sql="${1:?usage: probe-year-month-postgres.sh migration.sql}"
test -s "$sql"
container="pia_ux5_month_${GITHUB_RUN_ID:-local}"
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --rm --name "$container" -e POSTGRES_PASSWORD=fictional-ux5-test postgres:16-alpine >/dev/null
ready=0
for i in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then ready=1;break;fi
  sleep 1
done
test "$ready" = 1
pg(){ docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }
pg -c "CREATE TABLE monthly_evaluation(period VARCHAR(7) NOT NULL); CREATE TABLE leave_record(period VARCHAR(7) NOT NULL);" >/dev/null
pg -c "INSERT INTO monthly_evaluation VALUES ('2026-10'),('2026-13'); INSERT INTO leave_record VALUES ('2026-11');" >/dev/null
docker cp "$sql" "$container:/tmp/ux5.sql"
if pg -1 -f /tmp/ux5.sql >/dev/null 2>&1; then
  echo "UX5_ERROR_INVALID_HISTORICAL_ROW_ACCEPTED"; exit 1
fi
test "$(pg -c 'SELECT count(*) FROM monthly_evaluation')" = 2
test "$(pg -c "SELECT count(*) FROM pg_constraint WHERE conname LIKE 'chk_pia_%'")" = 0
pg -c "DELETE FROM monthly_evaluation WHERE period='2026-13';" >/dev/null
pg -1 -f /tmp/ux5.sql >/dev/null
test "$(pg -c "SELECT count(*) FROM pg_constraint WHERE conname LIKE 'chk_pia_%' AND convalidated")" = 2
test "$(pg -c "SELECT count(*) FROM monthly_evaluation WHERE period='2026-10'")" = 1
test "$(pg -c "SELECT count(*) FROM leave_record WHERE period='2026-11'")" = 1
pg -c "INSERT INTO monthly_evaluation VALUES ('2026-02'); INSERT INTO leave_record VALUES ('2026-12');" >/dev/null
if pg -c "INSERT INTO monthly_evaluation VALUES ('2026-00')" >/dev/null 2>&1; then
  echo "UX5_ERROR_INVALID_NEW_EVALUATION_ACCEPTED"; exit 1
fi
if pg -c "INSERT INTO leave_record VALUES ('2026-13')" >/dev/null 2>&1; then
  echo "UX5_ERROR_INVALID_NEW_LEAVE_ACCEPTED"; exit 1
fi
echo "PROTOCOLIA_UX5_PG_ATOMIC_ROLLBACK_AND_CHECK_VALIDATION_PASS"
