import test from "node:test";
import assert from "node:assert/strict";
import {providerJournalRuntimeIsolationSql} from "../../packages/adapters/provider-journal-runtime-isolation.mjs";

const tables=[
  "protocolia_provider_envelope_inbox",
  "protocolia_provider_receipt_candidate",
  "protocolia_provider_lifecycle_observation"
];
const functions=[
  "protocolia_record_provider_envelope_digest(text,text,text)",
  "protocolia_record_provider_receipt_candidate(text,text,text,text,text,numeric)",
  "protocolia_record_provider_lifecycle_observation(text,text,text,text,text,text,numeric,numeric,text)",
  "protocolia_provider_lifecycle_causal_projection(text)",
  "protocolia_provider_receipt_integrity_projection(text)"
];

test("runtime isolation is opt-in, deterministic, atomic and does not mutate finance",()=>{
  const sql=providerJournalRuntimeIsolationSql();
  assert.equal(sql,providerJournalRuntimeIsolationSql());
  assert.match(sql,/DO \$protocolia_provider_runtime_acl\$/);
  assert.match(sql,/current_setting\('protocolia\.provider_runtime_role',true\)/);
  assert.match(sql,/pg_advisory_xact_lock\(1927400411\)/);
  assert.match(sql,/IN SHARE ROW EXCLUSIVE MODE NOWAIT/);
  assert.match(sql,/tgtype IS DISTINCT FROM 27/);
  assert.match(sql,/tgtype IS DISTINCT FROM 34/);
  assert.match(sql,/tgenabled IS DISTINCT FROM 'O'/);
  assert.match(sql,/rolsuper/);
  assert.match(sql,/rolbypassrls/);
  assert.match(sql,/pg_has_role/);
  assert.match(sql,/has_schema_privilege\(runtime_role,'public','CREATE'\)/);
  assert.match(sql,/Public schema permits untrusted CREATE/);
  assert.match(sql,/has_table_privilege\(runtime_role/);
  assert.match(sql,/inherited direct journal access/);
  assert.doesNotMatch(sql,/\b(?:CREATE ROLE|DROP TABLE|TRUNCATE TABLE|INSERT INTO payment|UPDATE payment|SET provider_settlement_state)\b/i);
});

test("runtime receives no direct journal access; five vetted functions are the only gateway",()=>{
  const sql=providerJournalRuntimeIsolationSql();
  for(const table of tables)assert.ok(sql.includes("'"+table+"'"),table);
  for(const fn of functions)assert.ok(sql.includes("'"+fn+"'"),fn);
  assert.match(sql,/REVOKE ALL ON TABLE public\.%I FROM PUBLIC/);
  assert.match(sql,/REVOKE ALL ON TABLE public\.%I FROM %I/);
  assert.doesNotMatch(sql,/GRANT (?:ALL|SELECT|INSERT|UPDATE|DELETE|TRUNCATE) ON TABLE/i);
  assert.match(sql,/ALTER FUNCTION public\.%s SECURITY DEFINER/);
  assert.match(sql,/SET search_path TO pg_catalog, public, pg_temp/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.%s FROM PUBLIC/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.%s TO %I/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.protocolia_provider_envelope_immutable\(\) FROM PUBLIC/);
  assert.match(sql,/has_function_privilege\(runtime_role/);
  assert.match(sql,/Unexpected provider function EXECUTE grantee/);
  assert.match(sql,/a\.grantee NOT IN \(operator_oid,runtime_oid\)/);
  assert.ok(sql.indexOf("Preflight every object")<sql.indexOf("All preconditions hold"));
});
