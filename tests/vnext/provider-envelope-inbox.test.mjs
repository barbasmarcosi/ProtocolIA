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
  ])).length,7);
});
test("provider envelope replay key excludes rotating signing key and is append-only",()=>{
  const ddl=providerEnvelopeInboxSql(new Map([["financial",plan]])).join("\n");
  assert.match(ddl,/PRIMARY KEY \(provider_id,event_id\)/);
  assert.doesNotMatch(ddl,/key_id/);
  assert.match(ddl,/ON CONFLICT DO NOTHING/);
  assert.match(ddl,/RETURN 'duplicate'/);
  assert.match(ddl,/RETURN 'conflict'/);
  assert.match(ddl,/BEFORE UPDATE OR DELETE/);
  assert.doesNotMatch(ddl,/UPDATE payment|SET provider_settlement_state|settled/);
  assert.match(ddl,/REFERENCES payment\(receipt\) ON DELETE RESTRICT/);
  assert.match(ddl,/protocolia_record_provider_receipt_candidate/);
  assert.match(ddl,/actual_amount<>v_amount/);
  assert.match(ddl,/actual_state<>\x27posted\x27/);
  assert.match(ddl,/actual_proof<>\x27unverified\x27/);
  assert.match(ddl,/FOREIGN KEY\(provider_id,event_id\)/);
  assert.match(ddl,/protocolia_provider_receipt_candidate_immutable_guard/);
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
