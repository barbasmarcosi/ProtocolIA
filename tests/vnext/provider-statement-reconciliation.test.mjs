import test from "node:test";
import assert from "node:assert/strict";
import {reconcileProviderStatement as compare} from "../../packages/adapters/provider-statement-reconciliation.mjs";
const sample=()=>({
  currency:"ARS",scale:2,
  internal:[
    {receiptId:"PAY-1",orderId:"OT-1",amount:"0.30",currency:"ARS",status:"posted",proofState:"unverified"},
    {receiptId:"PAY-2",orderId:"OT-2",amount:"10.00",currency:"ARS",status:"posted",proofState:"unverified"}],
  links:[
    {receiptId:"PAY-1",providerId:"sandbox",transactionId:"tx-1"},
    {receiptId:"PAY-2",providerId:"sandbox",transactionId:"tx-2"}],
  external:[
    {providerId:"sandbox",transactionId:"tx-1",eventId:"cap-1",kind:"capture",amount:"0.10",currency:"ARS"},
    {providerId:"sandbox",transactionId:"tx-1",eventId:"cap-2",kind:"capture",amount:"0.20",currency:"ARS"},
    {providerId:"sandbox",transactionId:"tx-2",eventId:"cap-3",kind:"capture",amount:"10.00",currency:"ARS"}]
});
const clone=x=>structuredClone(x);
test("exact multi-capture decimal arithmetic; agreement remains explicitly UNVERIFIED",()=>{
  const result=compare(sample());
  assert.equal(result.result,"comparison_only_not_settlement_verification");
  assert.equal(result.independentlyAuthenticated,false);
  assert.deepEqual(result.totals,{postedInternal:"10.30",purportedCaptured:"10.30",purportedReturned:"0.00"});
  assert.equal(result.counts.exceptions,0);
  assert.equal(result.rows[0].classification,"amounts_agree_unverified");
  assert.equal(result.rows[0].externalCapture,"0.30");
  assert.equal(result.rows[1].classification,"amounts_agree_unverified");
  assert.equal(JSON.stringify(result).includes("bank_settled"),false);
});
test("missing and unlinked transactions fail visibly, no invented settlement",()=>{
  const a=sample();
  a.links.pop();
  a.external.pop();
  const x=compare(a);
  assert.equal(x.counts.exceptions,1);
  assert.equal(x.rows[1].classification,"unlinked");
  const b=sample();
  b.external.pop();
  assert.equal(compare(b).rows[1].classification,"missing_external_transaction");
});
test("capture discrepancies and partial refund/chargeback remain reviewable",()=>{
  const a=sample();
  a.external[2].amount="9.99";
  assert.equal(compare(a).rows[1].classification,"capture_amount_mismatch");
  const b=sample();
  b.external.push({providerId:"sandbox",transactionId:"tx-2",eventId:"refund-1",
    kind:"refund",amount:"1.50",currency:"ARS"});
  assert.equal(compare(b).rows[1].classification,"external_return_requires_review");
  const c=clone(b);
  c.external.push({providerId:"sandbox",transactionId:"tx-2",eventId:"cb-1",
    kind:"chargeback",amount:"9.00",currency:"ARS"});
  assert.equal(compare(c).rows[1].classification,"external_returns_exceed_capture");
  assert.equal(compare(c).totals.purportedReturned,"10.50");
});
test("reversed internally while externally captured never looks settled",()=>{
  const s=sample();s.internal[0].status="reversed";
  assert.equal(compare(s).rows[0].classification,"internal_reversal_requires_review");
  assert.equal(compare(s).totals.postedInternal,"10.00");
});
test("unknown external rows and orphan crosswalks are not silently omitted",()=>{
  const s=sample();
  s.external.push({providerId:"different",transactionId:"orphan",eventId:"unknown-1",
    kind:"capture",amount:"1.00",currency:"ARS"});
  s.links.push({receiptId:"NOT-THERE",providerId:"other",transactionId:"orphan-2"});
  assert.deepEqual(compare(s).exceptions.map(x=>x.code),
    ["orphan_mapping","unmatched_external_transaction"]);
});
test("duplicate receipt, crosswalk, transaction and external event fail closed",()=>{
  const s=sample();
  s.internal.push(clone(s.internal[0]));
  assert.throws(()=>compare(s),/Duplicate internal receipt/);
  const a=sample();a.links.push(clone(a.links[0]));
  assert.throws(()=>compare(a),/Multiple provider mappings/);
  const b=sample();b.links[1].transactionId="tx-1";
  assert.throws(()=>compare(b),/mapped to multiple receipts/);
  const c=sample();c.external.push({...c.external[0],transactionId:"tx-2"});
  assert.throws(()=>compare(c),/Duplicate external event identity/);
});
test("rejects floating point, scientific notation, negative, zero, excess scale, huge amounts",()=>{
  for(const invalid of [0.3,"1e2","-1.00","0.00","0.001","000.30","1,00","1.2 ","9".repeat(40)]) {
    const s=sample();s.internal[0].amount=invalid;
    assert.throws(()=>compare(s),/amount|precision|decimal|positive/i,String(invalid));
  }
});
test("rejects unknown source schema, currency/scale drift and fake settlement proof",()=>{
  const a=sample();a.internal[0].proofState="verified";
  assert.throws(()=>compare(a),/Cannot infer authority/);
  const b=sample();b.external[0].currency="USD";
  assert.throws(()=>compare(b),/currency mismatch/);
  const c=sample();c.currency="AR$";
  assert.throws(()=>compare(c),/Unsupported currency/);
  const d=sample();d.scale=7;
  assert.throws(()=>compare(d),/precision/);
  const e=sample();e.external[0].status="cleared";
  assert.throws(()=>compare(e),/unexpected/);
});
test("deterministic independent of input ordering; no mutations",()=>{
  const s=sample(), original=clone(s);
  const result=compare(s);
  assert.deepEqual(s,original);
  const t=clone(s);
  t.internal.reverse();t.links.reverse();t.external.reverse();
  assert.deepEqual(compare(t),result);
});
