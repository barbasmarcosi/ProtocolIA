import test from "node:test";
import assert from "node:assert/strict";
import {providerEnvelopeInboxSql} from "../../packages/adapters/provider-envelope-inbox.mjs";

test("provider inbox is opt-in only for fixed unverified ledger proof",()=>{
  assert.deepEqual(providerEnvelopeInboxSql(new Map()),[]);
  assert.deepEqual(providerEnvelopeInboxSql(new Map([["ordinary",{}]])),[]);
  assert.deepEqual(providerEnvelopeInboxSql(new Map([
    ["ordinary",{}],["financial",{unverifiedProofField:"providerSettlementState",
      childReadCapability:"payments.read"}]
  ])).length,4);
});
test("provider envelope replay key excludes rotating signing key and is append-only",()=>{
  const ddl=providerEnvelopeInboxSql(new Map([["financial",{
    unverifiedProofField:"providerSettlementState",childReadCapability:"payments.read"
  }]])).join("\n");
  assert.match(ddl,/PRIMARY KEY \(provider_id,event_id\)/);
  assert.doesNotMatch(ddl,/key_id/);
  assert.match(ddl,/ON CONFLICT DO NOTHING/);
  assert.match(ddl,/RETURN 'duplicate'/);
  assert.match(ddl,/RETURN 'conflict'/);
  assert.match(ddl,/BEFORE UPDATE OR DELETE/);
  assert.doesNotMatch(ddl,/UPDATE payment|SET provider_settlement_state|settled/);
});
test("inbox rejects unbound and malformed canonical plans",()=>{
  assert.throws(()=>providerEnvelopeInboxSql(null));
  assert.throws(()=>providerEnvelopeInboxSql(new Map([["financial",{
    unverifiedProofField:"providerSettlementState",childReadCapability:null
  }]])));
});
