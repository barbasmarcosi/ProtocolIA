#!/usr/bin/env bash
# Cross-cluster disaster-recovery proof. Synthetic data only.
# Requires Docker and disposable PostgreSQL 16; never target production.
set -euo pipefail
: "${PGHOST:?}" "${PGUSER:?}" "${PGDATABASE:?}" "${PGPASSWORD:?}"
tmp="$(mktemp -d)"
container="pia-s2c-cold-restore-$$"
cold_password="$(openssl rand -hex 32)"
cold_db="protocolia_s2c_cold_ci"
cold_port=""
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
source_sql() {
  psql -X -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" \
    -v ON_ERROR_STOP=1 -qAt -c "$1"
}
cold_admin() {
  PGHOST=127.0.0.1 PGPORT="$cold_port" PGUSER=postgres \
    PGDATABASE="$cold_db" PGPASSWORD="$cold_password" \
    psql -X -v ON_ERROR_STOP=1 -qAt -c "$1"
}
cold_login() {
  local principal="$1" password="$2" statement="$3"
  PGHOST=127.0.0.1 PGPORT="$cold_port" PGUSER="$principal" \
    PGDATABASE="$cold_db" PGPASSWORD="$password" \
    psql -X -v ON_ERROR_STOP=1 -qAt -c "$statement"
}
expect_fail() {
  if "$@" >"$tmp/negative.out" 2>"$tmp/negative.err"; then
    echo "Unexpectedly accepted unsafe cold-restore operation" >&2
    exit 1
  fi
}
counts() {
  local query="$1" expected_claims="$2" expected_receipts="$3"
  [[ "$("$query" "SELECT count(*) FROM protocolia_s2c_replay.claim")" == "$expected_claims" ]]
  [[ "$("$query" "SELECT count(*) FROM protocolia_s2c_replay.audit")" == "$expected_claims" ]]
  [[ "$("$query" "SELECT count(*) FROM protocolia_s2c_replay.batch_receipt")" == "$expected_receipts" ]]
}
fingerprint_query="SELECT
  (SELECT md5(string_agg(to_jsonb(c)::text, ',' ORDER BY tenant_id,provider_id,event_id)) FROM protocolia_s2c_replay.claim c)
  || ':' ||
  (SELECT md5(string_agg(to_jsonb(a)::text, ',' ORDER BY audit_id)) FROM protocolia_s2c_replay.audit a)
  || ':' ||
  (SELECT md5(string_agg(to_jsonb(r)::text, ',' ORDER BY tenant_id,provider_id,batch_sha256)) FROM protocolia_s2c_replay.batch_receipt r)"
sha="$(printf 'a%.0s' {1..64})"
event() {
  printf '[{"providerId":"sandbox","eventId":"%s","transactionId":"%s","kind":"capture","amount":"%s","currency":"ARS"}]' "$1" "$2" "$3"
}
counts source_sql 25 5
source_fingerprint="$(source_sql "$fingerprint_query")"
# Archive excludes cluster roles, making missing-principal restoration fail
# instead of silently assigning ownership to an administrative login.
pg_dump -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" \
  --schema=protocolia_s2c_replay --format=custom --file="$tmp/replay.dump"
[[ -s "$tmp/replay.dump" ]]
docker run -d --rm --name "$container" \
  -e POSTGRES_PASSWORD="$cold_password" -e POSTGRES_DB="$cold_db" \
  -p 127.0.0.1::5432 postgres:16 >"$tmp/container.id"
for i in {1..80}; do
  cold_port="$(docker port "$container" 5432/tcp 2>/dev/null | head -n1 | awk -F: '{print $NF}')"
  if [[ "$cold_port" =~ ^[0-9]+$ ]] &&
     PGHOST=127.0.0.1 PGPORT="$cold_port" PGUSER=postgres \
       PGDATABASE="$cold_db" PGPASSWORD="$cold_password" \
       pg_isready -q >/dev/null 2>&1; then break; fi
  sleep 1
done
[[ "$cold_port" =~ ^[0-9]+$ ]] || { echo "Cold PostgreSQL port unavailable" >&2; exit 1; }
cold_admin "SELECT 1" >/dev/null
# Prove the target is a different physical PostgreSQL cluster, not merely
# another database on the source server.
source_system_id="$(source_sql "SELECT system_identifier FROM pg_control_system()")"
cold_system_id="$(cold_admin "SELECT system_identifier FROM pg_control_system()")"
[[ -n "$source_system_id" && -n "$cold_system_id" && "$source_system_id" != "$cold_system_id" ]]
# Without owner/runtime principals, --single-transaction must roll back.
expect_fail env PGHOST=127.0.0.1 PGPORT="$cold_port" PGUSER=postgres \
  PGDATABASE="$cold_db" PGPASSWORD="$cold_password" \
  pg_restore --exit-on-error --single-transaction -d "$cold_db" "$tmp/replay.dump"
[[ "$(cold_admin "SELECT count(*) FROM pg_namespace WHERE nspname='protocolia_s2c_replay'")" == 0 ]]
# Explicitly recreate the minimal NOLOGIN owner, runtime and login bindings
# in the new cluster. No password, provider secret or old cluster data is
# imported as part of this bootstrap.
PGHOST=127.0.0.1 PGPORT="$cold_port" PGUSER=postgres \
  PGDATABASE="$cold_db" PGPASSWORD="$cold_password" \
  psql -X -v ON_ERROR_STOP=1 -q -f experiments/s2c-pg-replay/cold-restore-roles.sql
PGHOST=127.0.0.1 PGPORT="$cold_port" PGUSER=postgres \
  PGDATABASE="$cold_db" PGPASSWORD="$cold_password" \
  pg_restore --exit-on-error --single-transaction -d "$cold_db" "$tmp/replay.dump"
counts cold_admin 25 5
[[ "$(cold_admin "$fingerprint_query")" == "$source_fingerprint" ]]
[[ "$(cold_admin "SELECT count(*) FROM pg_roles WHERE rolname IN ('protocolia_s2c_owner','protocolia_s2c_runtime','protocolia_s2c_untrusted') AND NOT rolcanlogin")" == 3 ]]
[[ "$(cold_admin "SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='protocolia_s2c_replay.claim_with_receipt(text,text,text,jsonb)'::regprocedure")" == protocolia_s2c_owner ]]
[[ "$(cold_admin "SELECT has_function_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.claim_with_receipt(text,text,text,jsonb)','EXECUTE') AND NOT has_function_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.claim_verified_batch(text,text,text,jsonb)','EXECUTE') AND NOT has_table_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.claim','SELECT') AND NOT has_table_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.batch_receipt','INSERT')")" == t ]]
pass_a="$(openssl rand -hex 32)"
pass_b="$(openssl rand -hex 32)"
cold_admin "ALTER ROLE protocolia_s2c_a_sandbox_login PASSWORD '$pass_a'" >/dev/null
cold_admin "ALTER ROLE protocolia_s2c_b_sandbox_login PASSWORD '$pass_b'" >/dev/null
inspect_a() {
  cold_login protocolia_s2c_a_sandbox_login "$pass_a" \
    "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.inspect_committed_batch('sandbox','$1','$sha','$2'::jsonb)"
}
inspect_b() {
  cold_login protocolia_s2c_b_sandbox_login "$pass_b" \
    "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.inspect_committed_batch('sandbox','$1','$sha','$2'::jsonb)"
}
claim_a() {
  cold_login protocolia_s2c_a_sandbox_login "$pass_a" \
    "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.claim_with_receipt('sandbox','$1','$sha','$2'::jsonb)"
}
[[ "$(inspect_a OT-ACK "$(event ACK-LOST TX-A 0.03)")" == committed ]]
[[ "$(inspect_b OT-ACK "$(event ACK-LOST TX-A 0.03)")" == not_observed ]]
expect_fail inspect_a OT-ACK "$(event ACK-LOST TX-A 0.030)"
expect_fail claim_a OT-ACK "$(event ACK-LOST TX-A 0.03)"
expect_fail cold_login protocolia_s2c_a_sandbox_login "$pass_a" \
  "SET ROLE protocolia_s2c_runtime; SELECT * FROM protocolia_s2c_replay.audit"
expect_fail cold_login protocolia_s2c_a_sandbox_login "$pass_a" \
  "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.claim_verified_batch('sandbox','BYPASS','$sha','$(event BYPASS TX-B 0.01)'::jsonb)"
expect_fail cold_login protocolia_s2c_a_sandbox_login "$pass_a" \
  "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.claim_with_receipt('other','FORGED','$sha','$(event FORGED TX-F 0.01)'::jsonb)"
# A restored database must retain transactional atomicity: when the second
# event conflicts with an existing claim, the first event and its audit and
# batch receipt must all roll back. This is tested after cross-cluster restore,
# not merely on the original fixture.
rollback_batch="[$(event COLD-ROLLBACK TX-R 0.01 | sed 's/^\[//;s/\]$//'),$(event ACK-LOST TX-A 0.03 | sed 's/^\[//;s/\]$//')]"
expect_fail claim_a OT-ROLLBACK "$rollback_batch"
[[ "$(inspect_a OT-ROLLBACK "$(event COLD-ROLLBACK TX-R 0.01)")" == not_observed ]]
counts cold_admin 25 5
[[ "$(cold_admin "$fingerprint_query")" == "$source_fingerprint" ]]
# The restore must also retain append-only enforcement, including TRUNCATE.
expect_fail cold_login protocolia_s2c_a_sandbox_login "$pass_a" \
  "SET ROLE protocolia_s2c_runtime; TRUNCATE protocolia_s2c_replay.audit"
expect_fail cold_admin "UPDATE protocolia_s2c_replay.audit SET amount_text='9.99' WHERE event_id='ACK-LOST'"
expect_fail cold_admin "TRUNCATE protocolia_s2c_replay.batch_receipt"
counts cold_admin 25 5
[[ "$(cold_admin "$fingerprint_query")" == "$source_fingerprint" ]]
[[ "$(claim_a OT-COLD "$(event COLD-1 TX-C 0.01)")" == 1 ]]
[[ "$(inspect_a OT-COLD "$(event COLD-1 TX-C 0.01)")" == committed ]]
expect_fail claim_a OT-COLD "$(event COLD-1 TX-C 0.01)"
counts cold_admin 26 6
counts source_sql 25 5
[[ "$(source_sql "$fingerprint_query")" == "$source_fingerprint" ]]
echo "PROTOCOLIA_S2C_PG_COLD_RESTORE_PASS independent_cluster=pass missing_roles_rollback=pass restored=25/25/5 new_write=26/26/6 owner=NOLOGIN tenant_isolation=pass replay=blocked restored_batch_rollback=pass append_only=pass source_unchanged=pass"
