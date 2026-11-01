import test from "node:test";
import assert from "node:assert/strict";
import {reconcileProviderStatement as reconcile} from "../../packages/adapters/provider-statement-reconciliation.mjs";

// All synthetic amounts are exact decimal strings. This is a read-only
// diagnostic oracle, never a provider-cleared settlement assertion.
const base=()=>({
  currency:"ARS",scale:2,
  internal:[{receiptId:"P1",orderId:"O1",amount:"10.00",
    currency:"ARS",status:"posted",proofState:"unverified"}],
  internalReturns:[],
  links:[{receiptId:"P1",providerId:"sandbox",transactionId:"T1"}],
  external:[{providerId:"sandbox",transactionId:"T1",eventId:"C1",
    kind:"capture",amount:"10.00",currency:"ARS"}]
});
const returned=(eventId,amount,kind="refund")=>({
  providerId:"sandbox",transactionId:"T1",eventId,kind,amount,currency:"ARS"
});
const recorded=(amount,kind="refund")=>({
  receiptId:"P1",returnId:"R1",kind,amount,currency:"ARS",status:"recorded"
});
const codes=(result)=>result.exceptions.map(e=>e.code);

test("simultaneous wrong capture, over-return and return mismatch are ALL visible",()=>{
  const s=base();
  s.external[0].amount="9.00";
  s.external.push(returned("R-EXT","9.50"));
  s.internalReturns=[recorded("0.50")];
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"external_returns_exceed_capture");
  assert.deepEqual(codes(r),[
    "capture_amount_mismatch",
    "external_returns_exceed_capture",
    "return_amount_or_kind_mismatch"
  ]);
  assert.equal(r.counts.exceptions,3);
  assert.equal(r.independentlyAuthenticated,false);
  assert.equal(r.totals.purportedReturned,"9.50");
});

test("reversal does not hide amount or return mismatch or local double-credit risk",()=>{
  const s=base();
  s.internal[0].status="reversed";
  s.external[0].amount="9.00";
  s.external.push(returned("R-EXT","1.00"));
  s.internalReturns=[recorded("2.00")];
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"capture_amount_mismatch");
  assert.deepEqual(codes(r),[
    "capture_amount_mismatch",
    "internal_reversal_requires_review",
    "return_amount_or_kind_mismatch",
    "reversed_receipt_has_recorded_return"
  ]);
  assert.equal(r.totals.postedInternal,"0.00");
  assert.equal(r.counts.exceptions,4);
});

test("refund with no capture reports both missing capture and impossible return",()=>{
  const s=base();
  s.external=[returned("R-EXT","0.25")];
  s.internalReturns=[recorded("0.25")];
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"no_capture_reported");
  assert.deepEqual(codes(r),["external_returns_exceed_capture","no_capture_reported"]);
});

test("unmapped external refund cannot hide impossible provider arithmetic",()=>{
  const s=base();
  s.external.push({providerId:"sandbox",transactionId:"OTHER",eventId:"ORPHAN-R",
    kind:"refund",amount:"0.50",currency:"ARS"});
  const r=reconcile(s);
  assert.deepEqual(codes(r),[
    "external_returns_exceed_capture",
    "unmatched_external_transaction"
  ]);
  assert.equal(r.counts.exceptions,2);
});

test("normal partial return remains unverified with zero anomalies; deterministic and immutable",()=>{
  const s=base();
  s.external.push(returned("R-EXT","0.30"));
  s.internalReturns=[recorded("0.30")];
  const before=structuredClone(s);
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"returns_agree_unverified");
  assert.deepEqual(r.exceptions,[]);
  assert.equal(r.counts.exceptions,0);
  assert.deepEqual(s,before);
  assert.deepEqual(reconcile(s),r);
  const withoutJournal=structuredClone(s);
  delete withoutJournal.internalReturns;
  assert.deepEqual(codes(reconcile(withoutJournal)),["external_return_requires_review"]);
});
