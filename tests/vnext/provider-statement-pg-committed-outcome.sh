#!/usr/bin/env bash
# Run AFTER the legacy replay test and committed-outcome.sql upgrade.
# All operations use disposable PostgreSQL principals and synthetic amounts.
set -euo pipefail
PSQL=(psql -X -h "${PGHOST:-127.0.0.1}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 -qAt)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
sql() { "${PSQL[@]}" -c "$1"; }
pass_a="$(openssl rand -hex 32)"
pass_b="$(openssl rand -hex 32)"
sql "ALTER ROLE protocolia_s2c_a_sandbox_login PASSWORD '$pass_a'" >/dev/null
sql "ALTER ROLE protocolia_s2c_b_sandbox_login PASSWORD '$pass_b'" >/dev/null
login_sql() {
  PGUSER="$1" PGPASSWORD="$2" psql -X -h "${PGHOST:-127.0.0.1}" \
    -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 -qAt -c "$3"
}
sha="$(printf 'a%.0s' {1..64})"
event() {
  printf '[{"providerId":"sandbox","eventId":"%s","transactionId":"%s","kind":"%s","amount":"%s","currency":"ARS"}]' "$1" "$2" "$3" "$4"
}
claim() {
  login_sql protocolia_s2c_a_sandbox_login "$pass_a" "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.claim_with_receipt('sandbox','$1','$sha','$2'::jsonb)"
}
inspect() {
  login_sql protocolia_s2c_a_sandbox_login "$pass_a" "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.inspect_committed_batch('sandbox','$1','$sha','$2'::jsonb)"
}
expect_fail() {
  if "$@" >"$tmp/negative.out" 2>"$tmp/negative.err"; then
    echo "Unexpected acceptance: $*" >&2; exit 1
  fi
}
counts() {
  local expected="$1"
  [[ "$(sql "SELECT count(*) FROM protocolia_s2c_replay.claim")" == "$expected" ]]
  [[ "$(sql "SELECT count(*) FROM protocolia_s2c_replay.audit")" == "$expected" ]]
}
[[ "$(sql "SELECT count(*) FROM protocolia_s2c_replay.batch_receipt")" == 0 ]]
counts 19
[[ "$(sql "SELECT has_function_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.claim_with_receipt(text,text,text,jsonb)','EXECUTE') AND has_function_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.inspect_committed_batch(text,text,text,jsonb)','EXECUTE') AND NOT has_function_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.claim_verified_batch(text,text,text,jsonb)','EXECUTE') AND NOT has_table_privilege('protocolia_s2c_runtime','protocolia_s2c_replay.batch_receipt','SELECT')")" == t ]]
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a" "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.claim_verified_batch('sandbox','OT-1','$sha','$(event BYPASS-1 TX-B capture 0.01)'::jsonb)"
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a" "SET ROLE protocolia_s2c_runtime; SELECT * FROM protocolia_s2c_replay.batch_receipt"
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a" "SET ROLE protocolia_s2c_runtime; TRUNCATE protocolia_s2c_replay.batch_receipt"
expect_fail login_sql protocolia_s2c_a_sandbox_login "$pass_a" "SET ROLE protocolia_s2c_runtime; INSERT INTO protocolia_s2c_replay.batch_receipt DEFAULT VALUES"
# Legacy pre-upgrade claims are NOT retroactively considered receipt-backed.
expect_fail inspect OT-1 "$(event E-1 TX-1 capture 0.10)"
[[ "$(inspect OT-NEW "$(event MISSING-1 TX-M capture 0.01)")" == absent ]]
expect_fail inspect OT-NEW "$(event INVALID-1 TX-M capture 0)"
expect_fail inspect OT-NEW '[{"providerId":"sandbox","eventId":"X","transactionId":"T","kind":"capture","amount":"1.00","currency":"ARS","extra":1}]'
expect_fail inspect OT-NEW "[$(event X T capture 1.00 | sed 's/^\[//;s/\]$//'),$(event X T capture 1.00 | sed 's/^\[//;s/\]$//')]"
[[ "$(claim OT-NEW "$(event NEW-1 TX-N capture 0.10)")" == 1 ]]
counts 20
[[ "$(inspect OT-NEW "$(event NEW-1 TX-N capture 0.10)")" == committed ]]
expect_fail inspect OT-NEW "$(event NEW-1 TX-N capture 0.1)"
expect_fail inspect OT-OTHER "$(event NEW-1 TX-N capture 0.10)"
expect_fail claim OT-NEW "$(event NEW-1 TX-N capture 0.10)"
counts 20
# The other tenant cannot see the first tenant's receipt and can reuse the ID.
[[ "$(login_sql protocolia_s2c_b_sandbox_login "$pass_b" "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.inspect_committed_batch('sandbox','OT-NEW','$sha','$(event NEW-1 TX-N capture 0.10)'::jsonb)")" == absent ]]
[[ "$(login_sql protocolia_s2c_b_sandbox_login "$pass_b" "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.claim_with_receipt('sandbox','OT-NEW','$sha','$(event NEW-1 TX-N capture 0.10)'::jsonb)")" == 1 ]]
counts 21
[[ "$(login_sql protocolia_s2c_b_sandbox_login "$pass_b" "SET ROLE protocolia_s2c_runtime; SELECT protocolia_s2c_replay.inspect_committed_batch('sandbox','OT-NEW','$sha','$(event NEW-1 TX-N capture 0.10)'::jsonb)")" == committed ]]
# A batch with a duplicate later event cannot leave a receipt or audit fragment.
expect_fail claim OT-NEW "[$(event ROLLBACK-2 TX-R refund 0.01 | sed 's/^\[//;s/\]$//'),$(event NEW-1 TX-N capture 0.10 | sed 's/^\[//;s/\]$//')]"
counts 21
[[ "$(inspect OT-NEW "$(event ROLLBACK-2 TX-R refund 0.01)")" == absent ]]
# Receipt-backed two-event batch; a different requested grouping cannot be
# misidentified as a successfully committed atomic batch.
batch="[$(event PAIR-1 TX-P capture 0.10 | sed 's/^\[//;s/\]$//'),$(event PAIR-2 TX-P refund 0.02 | sed 's/^\[//;s/\]$//')]"
[[ "$(claim OT-PAIR "$batch")" == 2 ]]
counts 23
[[ "$(inspect OT-PAIR "$batch")" == committed ]]
expect_fail inspect OT-PAIR "$(event PAIR-1 TX-P capture 0.10)"
# Tampering by privileged fixture admin must be detected, not returned as
# committed. Runtime itself has no privilege to perform this mutation.
sql "ALTER TABLE protocolia_s2c_replay.audit DISABLE TRIGGER USER; UPDATE protocolia_s2c_replay.audit SET amount_text='9.99' WHERE tenant_id='tenant-a' AND event_id='PAIR-2'; ALTER TABLE protocolia_s2c_replay.audit ENABLE TRIGGER USER" >/dev/null
expect_fail inspect OT-PAIR "$batch"
sql "ALTER TABLE protocolia_s2c_replay.audit DISABLE TRIGGER USER; UPDATE protocolia_s2c_replay.audit SET amount_text='0.02' WHERE tenant_id='tenant-a' AND event_id='PAIR-2'; ALTER TABLE protocolia_s2c_replay.audit ENABLE TRIGGER USER" >/dev/null
[[ "$(inspect OT-PAIR "$batch")" == committed ]]
# Independent sessions race to write one receipt-backed claim.
pids=()
for i in {1..10}; do
  (claim OT-RACE "$(event RACE-REC TX-R capture 0.01)" >"$tmp/race-$i.out" 2>"$tmp/race-$i.err") &
  pids+=("$!")
done
wins=0
for pid in "${pids[@]}"; do if wait "$pid"; then wins=$((wins+1)); fi; done
[[ "$wins" == 1 ]] || { echo "Expected exactly one receipt-backed winner, got $wins" >&2; exit 1; }
counts 24
[[ "$(inspect OT-RACE "$(event RACE-REC TX-R capture 0.01)")" == committed ]]
# Commit succeeds, but the DB session is killed while sleeping AFTER COMMIT.
# The caller sees failure/lost acknowledgement; trusted lookup recovers it.
(
  login_sql protocolia_s2c_a_sandbox_login "$pass_a" "SET ROLE protocolia_s2c_runtime; BEGIN; SELECT protocolia_s2c_replay.claim_with_receipt('sandbox','OT-ACK','$sha','$(event ACK-LOST TX-A capture 0.03)'::jsonb); COMMIT; SET application_name='pia_s2c_ack_lost'; SELECT pg_sleep(30)" >"$tmp/ack.out" 2>"$tmp/ack.err"
) &
ack_pid=$!
backend=""
for i in {1..80}; do
  backend="$(sql "SELECT pid FROM pg_stat_activity WHERE application_name='pia_s2c_ack_lost' AND wait_event='PgSleep' LIMIT 1")"
  [[ -n "$backend" ]] && break
  sleep 0.2
done
[[ "$backend" =~ ^[0-9]+$ ]] || { echo "Ack-loss probe did not reach post-commit sleep" >&2; kill "$ack_pid" || true; exit 1; }
[[ "$(sql "SELECT pg_terminate_backend($backend)")" == t ]]
if wait "$ack_pid"; then echo "Terminated acknowledgement probe unexpectedly succeeded" >&2; exit 1; fi
counts 25
[[ "$(inspect OT-ACK "$(event ACK-LOST TX-A capture 0.03)")" == committed ]]
expect_fail claim OT-ACK "$(event ACK-LOST TX-A capture 0.03)"
[[ "$(sql "SELECT count(*) FROM protocolia_s2c_replay.batch_receipt")" == 5 ]]
echo "PROTOCOLIA_S2C_PG_ACK_RECOVERY_PASS claims=25 audit=25 receipts=5 post_commit_loss=committed tenant_isolation=pass tamper_fail_closed=pass legacy_fail_closed=pass concurrency=1/10 rollback=pass"
