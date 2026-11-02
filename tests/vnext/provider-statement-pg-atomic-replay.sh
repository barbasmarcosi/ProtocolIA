#!/usr/bin/env bash
# Disposable PostgreSQL 16+ integration proof. No external provider calls.
set -euo pipefail
PSQL=(psql -X -h "${PGHOST:-127.0.0.1}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 -qAt)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
sql() { "${PSQL[@]}" -c "$1"; }
# Credentials exist only in this disposable database and shell process.
# The provider proof uses real password-authenticated PostgreSQL sessions,
# not SET SESSION AUTHORIZATION impersonation by the admin connection.
pass_a_sandbox="$(openssl rand -hex 32)"
pass_a_other="$(openssl rand -hex 32)"
pass_b_sandbox="$(openssl rand -hex 32)"
sql "ALTER ROLE protocolia_s2c_a_sandbox_login PASSWORD '$pass_a_sandbox'" >/dev/null
sql "ALTER ROLE protocolia_s2c_a_other_login PASSWORD '$pass_a_other'" >/dev/null
sql "ALTER ROLE protocolia_s2c_b_sandbox_login PASSWORD '$pass_b_sandbox'" >/dev/null
login_sql() {
  local login="$1" password="$2" statement="$3"
  PGUSER="$login" PGPASSWORD="$password" psql -X -h "${PGHOST:-127.0.0.1}" \
    -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 -qAt -c "$statement"
}
sha="$(printf 'a%.0s' {1..64})"
event() {
  printf '[{"providerId":"%s","eventId":"%s","transactionId":"%s","kind":"%s","amount":"%s","currency":"ARS"}]' "$1" "$2" "$3" "$4" "$5"
}
claim() {
  local provider="$1" order="$2" payload="$3" tenant="${4:-tenant-a}"
  local login password
  case "$tenant:$provider" in
    tenant-a:sandbox) login=protocolia_s2c_a_sandbox_login; password="$pass_a_sandbox" ;;
    tenant-a:other) login=protocolia_s2c_a_other_login; password="$pass_a_other" ;;
    tenant-b:sandbox) login=protocolia_s2c_b_sandbox_login; password="$pass_b_sandbox" ;;
    *) echo "Unknown disposable test principal" >&2; return 1 ;;
  esac
  login_sql "$login" "$password" "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.claim_verified_batch('$provider','$order','$sha','$payload'::jsonb)"
}
count_claims() { sql "SELECT count(*) FROM protocolia_s2c_replay.claim"; }
count_audit() { sql "SELECT count(*) FROM protocolia_s2c_replay.audit"; }
expect_fail() {
  if "$@" >"$tmp/negative.out" 2>"$tmp/negative.err"; then
    echo "Unexpected acceptance: $*" >&2; exit 1
  fi
}
assert_count() {
  local expected="$1"
  [[ "$(count_claims)" == "$expected" && "$(count_audit)" == "$expected" ]] || {
    echo "Claim/audit counts diverged from $expected" >&2; exit 1;
  }
}
# Privilege boundary: password-authenticated DB session_user is bound to
# exactly one owner-controlled (tenant, provider) tuple. This is still a
# database-level proof, not a signed HTTP/provider identity integration.
[[ "$(sql "SELECT p.prosecdef AND p.proowner='protocolia_s2c_owner'::regrole FROM pg_proc p WHERE p.oid='protocolia_s2c_replay.claim_verified_batch(text,text,text,jsonb)'::regprocedure")" == t ]]
[[ "$(sql "SELECT count(*) FROM pg_roles WHERE rolname IN ('protocolia_s2c_owner','protocolia_s2c_runtime','protocolia_s2c_untrusted') AND NOT rolcanlogin")" == 3 ]]
[[ "$(sql "SELECT count(*) FROM pg_roles WHERE rolname IN ('protocolia_s2c_a_sandbox_login','protocolia_s2c_a_other_login','protocolia_s2c_b_sandbox_login') AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole")" == 3 ]]
[[ "$(login_sql protocolia_s2c_a_sandbox_login "$pass_a_sandbox" "SET ROLE protocolia_s2c_runtime; SELECT session_user || ':' || current_user")" == 'protocolia_s2c_a_sandbox_login:protocolia_s2c_runtime' ]]
[[ "$(sql "SELECT has_schema_privilege('protocolia_s2c_runtime','protocolia_s2c_replay','USAGE') AND NOT has_schema_privilege('protocolia_s2c_runtime','protocolia_s2c_replay','CREATE') AND has_function_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.claim_verified_batch(text,text,text,jsonb)','EXECUTE') AND NOT has_table_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.claim','INSERT') AND NOT has_table_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.audit','INSERT')")" == t ]]
expect_fail sql "SET ROLE protocolia_s2c_untrusted; SELECT protocolia_s2c_replay.claim_verified_batch('sandbox','OT-1','$sha','$(event sandbox FORGED TX-F capture 0.01)'::jsonb)"
expect_fail sql "SET ROLE protocolia_s2c_runtime; SELECT * FROM protocolia_s2c_replay.claim"
expect_fail sql "SET ROLE protocolia_s2c_runtime; INSERT INTO protocolia_s2c_replay.claim DEFAULT VALUES"
expect_fail sql "SET ROLE protocolia_s2c_runtime; INSERT INTO protocolia_s2c_replay.audit DEFAULT VALUES"
expect_fail sql "SET ROLE protocolia_s2c_runtime; UPDATE protocolia_s2c_replay.claim SET amount_text='9.00'"
expect_fail sql "SET ROLE protocolia_s2c_runtime; DELETE FROM protocolia_s2c_replay.audit"
expect_fail sql "SET ROLE protocolia_s2c_runtime; TRUNCATE protocolia_s2c_replay.claim"
expect_fail sql "SET ROLE protocolia_s2c_runtime; ALTER TABLE protocolia_s2c_replay.claim ADD COLUMN forged boolean"
expect_fail sql "SET ROLE protocolia_s2c_runtime; CREATE TABLE protocolia_s2c_replay.forged(id integer)"
# A role cannot invoke without assuming the restricted runtime role, edit
# its binding, impersonate another session_user, or claim another provider.
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a_sandbox" "SELECT protocolia_s2c_replay.claim_verified_batch('sandbox','OT-1','$sha','$(event sandbox FORGED-0 TX-F capture 0.01)'::jsonb)"
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a_sandbox" "SET ROLE protocolia_s2c_owner"
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a_sandbox" "SET SESSION AUTHORIZATION protocolia_s2c_b_sandbox_login"
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a_sandbox" "SET ROLE protocolia_s2c_runtime; SELECT * FROM protocolia_s2c_replay.principal_binding"
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a_sandbox" "SET ROLE protocolia_s2c_runtime; UPDATE protocolia_s2c_replay.principal_binding SET provider_id='other'"
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a_sandbox" "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.claim_verified_batch('other','OT-1','$sha','$(event other FORGED-1 TX-F capture 0.01)'::jsonb)"
expect_fail login_sql protocolia_s2c_a_other_login "$pass_a_other" "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.claim_verified_batch('sandbox','OT-1','$sha','$(event sandbox FORGED-2 TX-F capture 0.01)'::jsonb)"
assert_count 0
[[ "$(claim sandbox OT-1 "$(event sandbox E-1 TX-1 capture 0.10)")" == 1 ]]
assert_count 1
expect_fail claim sandbox OT-2 "$(event sandbox E-1 TX-2 capture 0.10)"
assert_count 1
# Mid-batch duplicate must roll back a previously inserted new event and audit.
expect_fail claim sandbox OT-1 "[{\"providerId\":\"sandbox\",\"eventId\":\"ROLLBACK\",\"transactionId\":\"TX-R\",\"kind\":\"refund\",\"amount\":\"0.01\",\"currency\":\"ARS\"},{\"providerId\":\"sandbox\",\"eventId\":\"E-1\",\"transactionId\":\"TX-1\",\"kind\":\"capture\",\"amount\":\"0.10\",\"currency\":\"ARS\"}]"
assert_count 1
for bad in 0 -1 1e2 0.0000001 999999999999999999999999999999999 1.2345678; do
  expect_fail claim sandbox OT-1 "$(event sandbox BAD-1 TX-B refund "$bad")"
done
expect_fail claim sandbox OT-1 "$(event foreign BAD-2 TX-B refund 0.01)"
expect_fail claim sandbox OT-1 '[{"providerId":"sandbox","eventId":"BAD-3","transactionId":"TX-B","kind":"refund","amount":1,"currency":"ARS"}]'
expect_fail claim sandbox OT-1 '[{"providerId":"sandbox","eventId":"BAD-4","transactionId":"TX-B","kind":"refund","amount":"1.00","currency":"ARS","extra":"forged"}]'
assert_count 1
# Independent providers can reuse an event ID; same provider cannot reuse it
# across different orders or signed statement bytes.
[[ "$(claim other OT-9 "$(event other E-1 TX-9 capture 0.20)")" == 1 ]]
[[ "$(claim sandbox OT-1 "$(event sandbox REF-1 TX-1 refund 0.01)")" == 1 ]]
[[ "$(claim sandbox OT-1 "$(event sandbox CB-1 TX-1 chargeback 0.01)")" == 1 ]]
assert_count 4
# The same (provider,event) belongs to a separate tenant's namespace.
[[ "$(claim sandbox OT-99 "$(event sandbox E-1 TX-99 capture 0.21)" tenant-b)" == 1 ]]
[[ "$(sql "SELECT count(*) FROM protocolia_s2c_replay.claim WHERE provider_id='sandbox' AND event_id='E-1' AND tenant_id IN ('tenant-a','tenant-b')")" == 2 ]]
assert_count 5
[[ "$(sql "SELECT amount_text FROM protocolia_s2c_replay.claim WHERE tenant_id='tenant-a' AND provider_id='sandbox' AND event_id='E-1'")" == "0.10" ]]
# An audit failure must roll back the claim atomically, including the event ID.
sql "CREATE FUNCTION protocolia_s2c_replay.fail_audit_test() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN IF NEW.event_id='AUDIT-FAIL' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END \$\$" >/dev/null
sql "CREATE TRIGGER injected_audit_failure BEFORE INSERT ON protocolia_s2c_replay.audit FOR EACH ROW EXECUTE FUNCTION protocolia_s2c_replay.fail_audit_test()" >/dev/null
expect_fail claim sandbox OT-1 "$(event sandbox AUDIT-FAIL TX-A capture 0.30)"
assert_count 5
sql "DROP TRIGGER injected_audit_failure ON protocolia_s2c_replay.audit" >/dev/null
[[ "$(claim sandbox OT-1 "$(event sandbox AUDIT-FAIL TX-A capture 0.30)")" == 1 ]]
assert_count 6
# Ten independent SQL sessions contend for the SAME unique provider/event key.
pids=()
for i in {1..10}; do
  (claim sandbox OT-1 "$(event sandbox RACE-1 TX-R capture 0.50)" >"$tmp/race-$i.out" 2>"$tmp/race-$i.err") &
  pids+=("$!")
done
wins=0
for pid in "${pids[@]}"; do
  if wait "$pid"; then wins=$((wins+1)); fi
done
[[ "$wins" == 1 ]] || { echo "Expected 1/10 accepted, got $wins" >&2; exit 1; }
assert_count 7
# Ten different event IDs must all commit with one audit row each.
pids=()
for i in {1..10}; do
  (claim sandbox OT-1 "$(event sandbox PAR-$i TX-$i capture 0.01)" >"$tmp/distinct-$i.out" 2>"$tmp/distinct-$i.err") &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
assert_count 17
expect_fail sql "UPDATE protocolia_s2c_replay.claim SET amount_text='9.00' WHERE event_id='E-1'"
expect_fail sql "DELETE FROM protocolia_s2c_replay.audit WHERE event_id='E-1'"
expect_fail sql "TRUNCATE protocolia_s2c_replay.claim CASCADE"
expect_fail sql "TRUNCATE protocolia_s2c_replay.audit"
assert_count 17
# No orphaned audit rows, no missing audit, all exact strings preserved.
[[ "$(sql "SELECT count(*) FROM protocolia_s2c_replay.claim c FULL JOIN protocolia_s2c_replay.audit a USING(tenant_id,provider_id,event_id) WHERE c.event_id IS NULL OR a.event_id IS NULL OR c.amount_text IS DISTINCT FROM a.amount_text OR c.statement_sha256 IS DISTINCT FROM a.statement_sha256")" == 0 ]]
# Crash a database session AFTER its claim and audit writes, BEFORE COMMIT.
# PostgreSQL must roll both back; the same event must be recoverable afterward.
(
  login_sql protocolia_s2c_a_sandbox_login "$pass_a_sandbox" "SET ROLE protocolia_s2c_runtime; BEGIN; SET LOCAL application_name='pia_s2c_crash_probe'; SELECT protocolia_s2c_replay.claim_verified_batch('sandbox','OT-1','$sha','$(event sandbox CRASH-1 TX-C capture 0.02)'::jsonb); SELECT pg_sleep(30); COMMIT;" >"$tmp/crash.out" 2>"$tmp/crash.err"
) &
crash_pid=$!
backend=""
for i in {1..60}; do
  backend="$(sql "SELECT pid FROM pg_stat_activity WHERE application_name='pia_s2c_crash_probe' AND wait_event='PgSleep' LIMIT 1")"
  [[ -n "$backend" ]] && break
  sleep 0.2
done
[[ "$backend" =~ ^[0-9]+$ ]] || { echo "Crash probe never reached post-write sleep" >&2; kill "$crash_pid" || true; exit 1; }
[[ "$(sql "SELECT pg_terminate_backend($backend)")" == t ]]
if wait "$crash_pid"; then echo "Terminated transaction unexpectedly committed" >&2; exit 1; fi
assert_count 17
[[ "$(claim sandbox OT-1 "$(event sandbox CRASH-1 TX-C capture 0.02)")" == 1 ]]
assert_count 18
# A runtime-created temporary table must not shadow the trusted schema's
# claim/audit tables inside the SECURITY DEFINER function.
[[ "$(login_sql protocolia_s2c_a_sandbox_login "$pass_a_sandbox" "SET ROLE protocolia_s2c_runtime; CREATE TEMP TABLE claim(bogus integer); CREATE TEMP TABLE audit(bogus integer); SELECT protocolia_s2c_replay.claim_verified_batch('sandbox','OT-1','$sha','$(event sandbox SHADOW-1 TX-S capture 0.03)'::jsonb)")" == 1 ]]
assert_count 19
echo "PROTOCOLIA_S2C_PG_ATOMIC_REPLAY_PASS claims=19 audit=19 principal_binding=pass tenant_isolation=pass least_privilege=pass temp_shadow=pass concurrent_same=1/10 concurrent_distinct=10/10 crash_rollback=pass"
