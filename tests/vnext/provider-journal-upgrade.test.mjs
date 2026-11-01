import test from "node:test";
import assert from "node:assert/strict";
import {providerJournalTruncateUpgradeSql} from "../../packages/adapters/provider-journal-upgrade.mjs";

test("reviewable populated upgrade is deterministic and has no financial DML",()=>{
  const sql=providerJournalTruncateUpgradeSql();
  assert.equal(sql,providerJournalTruncateUpgradeSql());
  assert.ok(sql.includes("DO $protocolia_provider_upgrade$"));
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/IN SHARE ROW EXCLUSIVE MODE NOWAIT/);
  assert.ok(sql.indexOf('IN SHARE ROW EXCLUSIVE MODE NOWAIT')<sql.indexOf('Validate the complete historical guard set'));
  assert.match(sql,/to_regprocedure/);
  assert.match(sql,/pg_get_functiondef/);
  assert.match(sql,/tgtype IS DISTINCT FROM 27/);
  assert.match(sql,/tgtype IS DISTINCT FROM 34/);
  assert.match(sql,/tgenabled IS DISTINCT FROM 'O'/);
  assert.match(sql,/CREATE TRIGGER %I BEFORE TRUNCATE/);
  assert.match(sql,/IF NOT EXISTS \(SELECT 1 FROM pg_trigger/);
  assert.match(sql,/row guard missing\/drifted/);
  assert.match(sql,/TRUNCATE guard drifted/);
  for(const table of [
    "protocolia_provider_envelope_inbox",
    "protocolia_provider_receipt_candidate",
    "protocolia_provider_lifecycle_observation"
  ])assert.ok(sql.includes("'"+table+"'"),table);
  assert.doesNotMatch(sql,/\b(?:DROP TABLE|TRUNCATE TABLE|DELETE FROM|UPDATE payment|INSERT INTO payment|SET provider_settlement_state)\b/i);
  assert.doesNotMatch(sql,/SECURITY DEFINER|CREATE ROLE|GRANT ALL/i);
});

test("historical guard names and immutable trigger function are pinned",()=>{
  const sql=providerJournalTruncateUpgradeSql();
  assert.ok(sql.includes("'protocolia_provider_envelope_immutable_guard'"));
  assert.ok(sql.includes("journal||'_immutable_guard'"));
  assert.ok(sql.includes("row_guard||'_truncate'"));
  assert.ok(sql.includes("public.protocolia_provider_envelope_immutable()"));
  assert.ok(sql.indexOf("Validate the complete historical guard set")<
    sql.indexOf("Every historical object is valid"));
});
