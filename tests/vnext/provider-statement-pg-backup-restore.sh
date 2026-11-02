#!/usr/bin/env bash
# S2c disposable logical backup/restore acceptance. Run only after the
# populated 25-claim/5-receipt fixture and committed-outcome upgrade.
# This is NOT a production DR procedure: cluster roles already exist.
set -euo pipefail
: "$PGHOST" "$PGUSER" "$PGDATABASE" "$PGPASSWORD"
tmp="$(mktemp -d)"
restore_db=""
cleanup() {
  if [[ -n "$restore_db" ]]; then
    dropdb --if-exists -h "$PGHOST" -U "$PGUSER" "$restore_db" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT
admin_sql() {
  psql -X -h "$PGHOST" -U "$PGUSER" -d "$1" -v ON_ERROR_STOP=1 -qAt -c "$2"
}
login_sql() {
  local login="$1" password="$2" db="$3" statement="$4"
  PGUSER="$login" PGPASSWORD="$password" psql -X -h "$PGHOST" -U "$login" \
    -d "$db" -v ON_ERROR_STOP=1 -qAt -c "$statement"
}
expect_fail() {
  if "$@" >"$tmp/negative.out" 2>"$tmp/negative.err"; then
    echo "Unexpected acceptance in restored database" >&2
    exit 1
  fi
}
assert_counts() {
  local db="$1" claims="$2" receipts="$3"
  [[ "$(admin_sql "$db" "SELECT count(*) FROM protocolia_s2c_replay.claim")" == "$claims" ]]
  [[ "$(admin_sql "$db" "SELECT count(*) FROM protocolia_s2c_replay.audit")" == "$claims" ]]
  [[ "$(admin_sql "$db" "SELECT count(*) FROM protocolia_s2c_replay.batch_receipt")" == "$receipts" ]]
  [[ "$(admin_sql "$db" "SELECT count(*) FROM protocolia_s2c_replay.claim c FULL JOIN protocolia_s2c_replay.audit a USING (tenant_id,provider_id,event_id) WHERE c.event_id IS NULL OR a.event_id IS NULL OR c.amount_text IS DISTINCT FROM a.amount_text OR c.statement_sha256 IS DISTINCT FROM a.statement_sha256")" == 0 ]]
}
fingerprint() {
  admin_sql "$1" "SELECT
    (SELECT md5(string_agg(to_jsonb(c)::text, ',' ORDER BY tenant_id,provider_id,event_id)) FROM protocolia_s2c_replay.claim c)
    || ':' ||
    (SELECT md5(string_agg(to_jsonb(a)::text, ',' ORDER BY audit_id)) FROM protocolia_s2c_replay.audit a)
    || ':' ||
    (SELECT md5(string_agg(to_jsonb(r)::text, ',' ORDER BY tenant_id,provider_id,batch_sha256)) FROM protocolia_s2c_replay.batch_receipt r)"
}
sha="$(printf 'a%.0s' {1..64})"
event() {
  printf '[{"providerId":"sandbox","eventId":"%s","transactionId":"%s","kind":"capture","amount":"%s","currency":"ARS"}]' "$1" "$2" "$3"
}
# Verify a populated source before taking a consistent logical snapshot.
assert_counts "$PGDATABASE" 25 5
source_fingerprint="$(fingerprint "$PGDATABASE")"
pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
  --schema=protocolia_s2c_replay --format=custom --file="$tmp/replay.dump"
[[ -s "$tmp/replay.dump" ]]
restore_db="protocolia_s2c_restore_$RANDOM"
createdb -h "$PGHOST" -U "$PGUSER" -T template0 "$restore_db"
# Do not use --no-owner/--no-acl: SECURITY DEFINER ownership and restricted
# EXECUTE grants are part of the recovery invariant.
pg_restore -h "$PGHOST" -U "$PGUSER" -d "$restore_db" \
  --exit-on-error --single-transaction "$tmp/replay.dump"
assert_counts "$restore_db" 25 5
[[ "$(fingerprint "$restore_db")" == "$source_fingerprint" ]]
[[ "$(admin_sql "$restore_db" "SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='protocolia_s2c_replay.claim_with_receipt(text,text,text,jsonb)'::regprocedure")" == protocolia_s2c_owner ]]
[[ "$(admin_sql "$restore_db" "SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='protocolia_s2c_replay.inspect_committed_batch(text,text,text,jsonb)'::regprocedure")" == protocolia_s2c_owner ]]
[[ "$(admin_sql "$restore_db" "SELECT NOT rolcanlogin FROM pg_roles WHERE rolname='protocolia_s2c_owner'")" == t ]]
[[ "$(admin_sql "$restore_db" "SELECT has_function_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.claim_with_receipt(text,text,text,jsonb)','EXECUTE') AND has_function_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.inspect_committed_batch(text,text,text,jsonb)','EXECUTE') AND NOT has_function_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.claim_verified_batch(text,text,text,jsonb)','EXECUTE') AND NOT has_table_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.claim','SELECT') AND NOT has_table_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.batch_receipt','INSERT')")" == t ]]
# Passwords and role membership are cluster-level prerequisites, not
# contained in pg_dump. Rotate only the disposable fixture logins.
pass_a="$(openssl rand -hex 32)"
pass_b="$(openssl rand -hex 32)"
admin_sql "$restore_db" "ALTER ROLE protocolia_s2c_a_sandbox_login PASSWORD '$pass_a'" >/dev/null
admin_sql "$restore_db" "ALTER ROLE protocolia_s2c_b_sandbox_login PASSWORD '$pass_b'" >/dev/null
inspect_a() {
  login_sql protocolia_s2c_a_sandbox_login "$pass_a" "$restore_db" \
    "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.inspect_committed_batch('sandbox','$1','$sha','$2'::jsonb)"
}
inspect_b() {
  login_sql protocolia_s2c_b_sandbox_login "$pass_b" "$restore_db" \
    "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.inspect_committed_batch('sandbox','$1','$sha','$2'::jsonb)"
}
claim_a() {
  login_sql protocolia_s2c_a_sandbox_login "$pass_a" "$restore_db" \
    "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.claim_with_receipt('sandbox','$1','$sha','$2'::jsonb)"
}
# Exact original evidence survives restore and remains tenant-scoped.
[[ "$(inspect_a OT-ACK "$(event ACK-LOST TX-A 0.03)")" == committed ]]
[[ "$(inspect_b OT-ACK "$(event ACK-LOST TX-A 0.03)")" == not_observed ]]
[[ "$(inspect_a OT-NEW "$(event NEW-1 TX-N 0.10)")" == committed ]]
[[ "$(inspect_b OT-NEW "$(event NEW-1 TX-N 0.10)")" == committed ]]
expect_fail inspect_a OT-NEW "$(event NEW-1 TX-N 0.1)"
expect_fail claim_a OT-ACK "$(event ACK-LOST TX-A 0.03)"
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a" "$restore_db" \
  "SET ROLE protocolia_s2c_runtime; SELECT * FROM protocolia_s2c_replay.audit"
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a" "$restore_db" \
  "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.claim_verified_batch('sandbox','BYPASS','$sha','$(event BYPASS TX-B 0.01)'::jsonb)"
expect_fail admin_sql "$restore_db" \
  "UPDATE protocolia_s2c_replay.audit SET amount_text='9.99' WHERE event_id='ACK-LOST'"
expect_fail admin_sql "$restore_db" \
  "UPDATE protocolia_s2c_replay.batch_receipt SET order_id='FORGED' WHERE order_id='OT-ACK'"
assert_counts "$restore_db" 25 5
[[ "$(fingerprint "$restore_db")" == "$source_fingerprint" ]]
# A restored database must accept a NEW atomic receipt without touching the
# original source, then deny duplicate replay and preserve the audit pair.
[[ "$(claim_a OT-RESTORE "$(event RESTORE-1 TX-RESTORE 0.01)")" == 1 ]]
[[ "$(inspect_a OT-RESTORE "$(event RESTORE-1 TX-RESTORE 0.01)")" == committed ]]
expect_fail claim_a OT-RESTORE "$(event RESTORE-1 TX-RESTORE 0.01)"
assert_counts "$restore_db" 26 6
assert_counts "$PGDATABASE" 25 5
[[ "$(fingerprint "$PGDATABASE")" == "$source_fingerprint" ]]
[[ "$(fingerprint "$restore_db")" != "$source_fingerprint" ]]
echo "PROTOCOLIA_S2C_PG_RESTORE_PASS source=25/25/5 restored=26/26/6 owner=NOLOGIN grants=restricted tenant_scope=pass immutable=pass replay=blocked"
