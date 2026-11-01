import test from "node:test";
import assert from "node:assert/strict";
import {providerEnvelopeInboxSql} from "../../packages/adapters/provider-envelope-inbox.mjs";

const candidate={childTable:"payment",receiptColumn:"receipt",referenceColumn:"order_number",
  amountColumn:"amount",stateColumn:"status",postedState:"posted",
  proofColumn:"provider_settlement_state",precision:14,scale:2,max:"999999999999.99"};
const plan={unverifiedProofField:"providerSettlementState",
  childReadCapability:"payments.read",providerCandidate:candidate};

test("provider inbox is opt-in only for fixed unverified ledger proof",()=>{
  assert.deepEqual(providerEnvelopeInboxSql(new Map()),[]);
  assert.deepEqual(providerEnvelopeInboxSql(new Map([["ordinary",{}]])),[]);
  assert.deepEqual(providerEnvelopeInboxSql(new Map([
    ["ordinary",{}],["financial",plan]
  ])).length,12);
});
test("provider envelope replay key excludes rotating signing key and is append-only",()=>{
  const ddl=providerEnvelopeInboxSql(new Map([["financial",plan]])).join("\n");
  assert.match(ddl,/PRIMARY KEY \(provider_id,event_id\)/);
  assert.doesNotMatch(ddl,/key_id/);
  assert.match(ddl,/ON CONFLICT DO NOTHING/);
  assert.match(ddl,/RETURN 'duplicate'/);
  assert.match(ddl,/RETURN 'conflict'/);
  assert.match(ddl,/BEFORE UPDATE OR DELETE/);
  // PostgreSQL TRUNCATE bypasses row-level UPDATE/DELETE triggers entirely.
  // The generated database owner must be unable to erase replay history.
  for(const table of ["protocolia_provider_envelope_inbox",
    "protocolia_provider_receipt_candidate",
    "protocolia_provider_lifecycle_observation"]){
    assert.match(ddl,new RegExp("BEFORE TRUNCATE ON "+table+
      "\\\\n      FOR EACH STATEMENT EXECUTE FUNCTION protocolia_provider_envelope_immutable"));
  }
  assert.doesNotMatch(ddl,/UPDATE payment|SET provider_settlement_state|settled/);
  assert.match(ddl,/REFERENCES payment\(receipt\) ON DELETE RESTRICT/);
  assert.match(ddl,/protocolia_record_provider_receipt_candidate/);
  assert.match(ddl,/actual_amount<>v_amount/);
  assert.match(ddl,/actual_state<>\x27posted\x27/);
  assert.match(ddl,/actual_proof<>\x27unverified\x27/);
  assert.match(ddl,/FOREIGN KEY\(provider_id,event_id\)/);
  assert.match(ddl,/protocolia_provider_receipt_candidate_immutable_guard/);
  // S2c-1c4a: a receipt has one candidate binding across providers/events.
  // Subsequent lifecycle events must reference the existing candidate.
  assert.match(ddl,/UNIQUE \(receipt_id\)/);
  assert.match(ddl,/SELECT provider_id,event_id INTO bound_provider,bound_event/);
  // An in-flight first delivery may commit while another waits for the
  // receipt lock; the second must recheck and return duplicate, not conflict.
  const candidateSql=ddl.slice(ddl.indexOf("CREATE FUNCTION protocolia_record_provider_receipt_candidate"),
    ddl.indexOf("CREATE TRIGGER protocolia_provider_receipt_candidate_immutable_guard"));
  assert.equal(candidateSql.split("SELECT payload_sha256 INTO old_digest").length-1,2);
  assert.ok(ddl.indexOf("SELECT p.order_number,p.amount,p.status,p.provider_settlement_state")<
    ddl.lastIndexOf("SELECT payload_sha256 INTO old_digest"));

  assert.match(ddl,/WHERE receipt_id=v_receipt;[\s\S]*IF FOUND THEN RETURN 'conflict'/);
  assert.ok(ddl.indexOf("WHERE receipt_id=v_receipt;")<
    ddl.lastIndexOf("SELECT protocolia_record_provider_envelope_digest(v_provider,v_event,v_digest)"));

  // Historical authenticated replay is classified before mutable receipt status.
  assert.match(ddl,/SELECT payload_sha256 INTO old_digest[\s\S]*FOR UPDATE/);
  assert.match(ddl,/old_digest IS DISTINCT FROM v_digest/);
  assert.match(ddl,/IF old_receipt=v_receipt AND old_order=v_order AND old_amount=v_amount[\s\S]*RETURN 'duplicate'/);
  assert.ok(ddl.indexOf("SELECT payload_sha256 INTO old_digest")<
    ddl.indexOf("SELECT p.order_number,p.amount,p.status,p.provider_settlement_state"));

});
test("inbox rejects unbound and malformed canonical plans",()=>{
  assert.throws(()=>providerEnvelopeInboxSql(null));
  assert.throws(()=>providerEnvelopeInboxSql(new Map([["financial",{
    unverifiedProofField:"providerSettlementState",childReadCapability:null
  }]])));
});

test("receipt candidate refuses missing, ambiguous or unsafe canonical binding",()=>{
  assert.throws(()=>providerEnvelopeInboxSql(new Map([["bad",{
    unverifiedProofField:"providerSettlementState",childReadCapability:"payments.read"
  }]])),/one canonical exact ledger|Invalid canonical/);
  assert.throws(()=>providerEnvelopeInboxSql(new Map([["bad",{
    ...plan,providerCandidate:{...candidate,childTable:"payment;DROP TABLE payment"}
  }]])),/Invalid canonical/);
  assert.throws(()=>providerEnvelopeInboxSql(new Map([["bad",{
    ...plan,providerCandidate:{...candidate,scale:3}
  }],["other",plan]])),/one canonical exact ledger/);
});

test("sandbox lifecycle observations are sequenced, append-only and never settlement",()=>{
  const ddl=providerEnvelopeInboxSql(new Map([["financial",plan]])).join("\n");
  assert.match(ddl,/CREATE TABLE protocolia_provider_lifecycle_observation/);
  assert.match(ddl,/UNIQUE \(receipt_id,event_sequence\)/);
  assert.match(ddl,/FOREIGN KEY \(provider_id,candidate_event_id,receipt_id,order_id,amount\)/);
  assert.match(ddl,/REFERENCES protocolia_provider_receipt_candidate/);
  assert.match(ddl,/protocolia_record_provider_lifecycle_observation/);
  assert.match(ddl,/v_sequence<>TRUNC\(v_sequence\)/);
  assert.match(ddl,/reported_phase IN \('reported_pending','reported_success'/);
  assert.match(ddl,/protocolia_provider_lifecycle_observation_immutable_guard/);
  assert.match(ddl,/WHERE receipt_id=v_receipt AND event_sequence=v_sequence/);
  assert.match(ddl,/SELECT payload_sha256 INTO old_digest/);
  assert.doesNotMatch(ddl,/UPDATE payment|SET provider_settlement_state/);
});

test("causal projection is read-only, gap-aware and cannot grant settlement authority",()=>{
  const ddl=providerEnvelopeInboxSql(new Map([["financial",plan]])).join("\n");
  const projection=ddl.slice(ddl.indexOf("CREATE FUNCTION protocolia_provider_lifecycle_causal_projection"));
  assert.match(projection,/LANGUAGE SQL STABLE/);
  assert.match(projection,/ROW_NUMBER\(\) OVER \(ORDER BY event_sequence\)/);
  assert.match(projection,/LAG\(reported_phase\) OVER \(ORDER BY event_sequence\)/);
  assert.match(projection,/WHEN has_gap THEN 'gap'/);
  assert.match(projection,/WHEN invalid_transition THEN 'contradictory'/);
  assert.match(projection,/reported_phase<>'reported_pending'/);
  assert.match(projection,/previous_phase='reported_failure'/);
  assert.match(projection,/previous_phase='reported_reversal'/);
  assert.doesNotMatch(projection,/UPDATE |DELETE |INSERT |SET provider_settlement_state|SECURITY DEFINER/);
});

test("receipt integrity projection rejects stale internal state and never grants settlement",()=>{
  const ddl=providerEnvelopeInboxSql(new Map([["financial",plan]])).join("\n");
  const projection=ddl.slice(ddl.indexOf("CREATE FUNCTION protocolia_provider_receipt_integrity_projection"));
  assert.match(projection,/LANGUAGE SQL STABLE/);
  assert.match(projection,/protocolia_provider_lifecycle_causal_projection\(v_receipt\)/);
  assert.match(projection,/c\.order_id IS DISTINCT FROM r\.order_id/);
  assert.match(projection,/c\.amount IS DISTINCT FROM r\.amount/);
  assert.match(projection,/r\.receipt_state IS DISTINCT FROM 'posted'/);
  assert.match(projection,/r\.proof_state IS DISTINCT FROM 'unverified'/);
  // Coherent is a causal property, not proof of a successful outcome.
  // Pending, failure and reversal must never be flattened to synthetic_only.
  for(const [phase,state] of [
    ["reported_pending","synthetic_pending"],
    ["reported_failure","synthetic_failure"],
    ["reported_reversal","synthetic_reversal"],
    ["reported_success","synthetic_only"]
  ])assert.match(projection,new RegExp(
    "WHEN projection\\.causal_integrity='coherent' AND\\s+"+
    "projection\\.last_coherent_phase='"+phase+"' THEN '"+state+"'"));
  assert.match(projection,/ELSE 'causal_unknown' END/);
  for(const state of ["missing","unbound","claim_mismatch","not_posted",
    "proof_changed","no_lifecycle","causal_gap","causal_contradictory",
    "synthetic_pending","synthetic_failure","synthetic_reversal",
    "synthetic_only","causal_unknown"])
    assert.ok(projection.includes("'"+state+"'"),state);
  assert.doesNotMatch(projection,/UPDATE |DELETE |INSERT |SECURITY DEFINER|SET provider_settlement_state/);
});
