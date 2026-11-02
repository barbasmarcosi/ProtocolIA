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

test("refund without capture in this snapshot reports both incomplete coverage signals",()=>{
  const s=base();
  s.external=[returned("R-EXT","0.25")];
  s.internalReturns=[recorded("0.25")];
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"no_capture_reported");
  assert.deepEqual(codes(r),["external_returns_exceed_capture","no_capture_reported"]);
});

test("unmapped external refund still reports snapshot-level return excess",()=>{
  const s=base();
  s.external.push({providerId:"sandbox",transactionId:"OTHER",eventId:"ORPHAN-R",
    kind:"refund",amount:"0.50",currency:"ARS"});
  const r=reconcile(s);
  assert.deepEqual(codes(r),[
    "external_return_requires_review",
    "external_returns_exceed_capture",
    "unmatched_external_transaction"
  ]);
  assert.equal(r.counts.exceptions,3);
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

test("two partial captures summing to the receipt require review, never clean agreement",()=>{
  const s=base();
  s.external[0].amount="4.00";
  s.external.push({...s.external[0],eventId:"C2",amount:"6.00"});
  const before=structuredClone(s);
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"multiple_capture_events_require_review");
  assert.deepEqual(codes(r),["multiple_capture_events_require_review"]);
  assert.equal(r.counts.amountsAgreeUnverified,0);
  assert.equal(r.counts.exceptions,1);
  assert.equal(r.totals.purportedCaptured,"10.00");
  assert.deepEqual(s,before);
  s.external.reverse();
  assert.deepEqual(reconcile(s),r);
});

test("two captures with wrong sum expose both independent discrepancies",()=>{
  const s=base();
  s.external.push({...s.external[0],eventId:"C2"});
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"capture_amount_mismatch");
  assert.deepEqual(codes(r),[
    "capture_amount_mismatch","multiple_capture_events_require_review"
  ]);
  assert.equal(r.totals.purportedCaptured,"20.00");
});

test("multiple captures for unmatched external transaction are not hidden by orphan label",()=>{
  const s=base();
  s.external.push(
    {...s.external[0],transactionId:"UNLINKED",eventId:"O1",amount:"1.00"},
    {...s.external[0],transactionId:"UNLINKED",eventId:"O2",amount:"1.00"}
  );
  const r=reconcile(s);
  assert.deepEqual(codes(r),[
    "multiple_capture_events_require_review","unmatched_external_transaction"
  ]);
});

test("one capture per independently linked transaction remains non-authoritative but clean",()=>{
  const s=base();
  s.internal.push({...s.internal[0],receiptId:"P2"});
  s.links.push({...s.links[0],receiptId:"P2",transactionId:"T2"});
  s.external.push({...s.external[0],transactionId:"T2",eventId:"C2"});
  const r=reconcile(s);
  assert.equal(r.counts.exceptions,0);
  assert.equal(r.counts.amountsAgreeUnverified,2);
  assert.equal(r.independentlyAuthenticated,false);
});

test("external return remains independently visible without journal despite wrong capture",()=>{
  const s=base();
  delete s.internalReturns;
  s.external[0].amount="9.00";
  s.external.push(returned("R-EXT","0.50"));
  const before=structuredClone(s);
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"capture_amount_mismatch");
  assert.deepEqual(codes(r),[
    "capture_amount_mismatch","external_return_requires_review"
  ]);
  assert.equal(r.totals.purportedReturned,"0.50");
  assert.equal(r.totals.internallyRecordedReturns,null);
  assert.deepEqual(s,before);
  s.external.reverse();
  assert.deepEqual(reconcile(s),r);
});

test("external return without journal is not masked by an internal reversal",()=>{
  const s=base();
  delete s.internalReturns;
  s.internal[0].status="reversed";
  s.external.push(returned("R-EXT","0.25"));
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"internal_reversal_requires_review");
  assert.deepEqual(codes(r),[
    "external_return_requires_review","internal_reversal_requires_review"
  ]);
  assert.equal(r.totals.postedInternal,"0.00");
});

test("two same-kind partial provider returns matching internal total require review",()=>{
  const s=base();
  s.internalReturns=[recorded("1.00")];
  s.external.push(returned("R-EXT-1","0.40"),returned("R-EXT-2","0.60"));
  const before=structuredClone(s);
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"multiple_return_events_require_review");
  assert.deepEqual(codes(r),["multiple_return_events_require_review"]);
  assert.equal(r.counts.returnsAgreeUnverified,0);
  assert.equal(r.totals.purportedReturned,"1.00");
  assert.deepEqual(s,before);
  s.external.reverse();
  assert.deepEqual(reconcile(s),r);
});

test("repeated same-kind returns and amount mismatch are both surfaced",()=>{
  const s=base();
  s.internalReturns=[recorded("1.00")];
  s.external.push(returned("R-EXT-1","0.40"),returned("R-EXT-2","0.70"));
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"return_amount_or_kind_mismatch");
  assert.deepEqual(codes(r),[
    "multiple_return_events_require_review","return_amount_or_kind_mismatch"
  ]);
});

test("one refund and one chargeback are not incorrectly classified as repeated same-kind returns",()=>{
  const s=base();
  s.internalReturns=[recorded("0.40"),{
    ...recorded("0.60","chargeback"),returnId:"R2"
  }];
  s.external.push(returned("EXT-R","0.40"),returned("EXT-C","0.60","chargeback"));
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"returns_agree_unverified");
  assert.deepEqual(codes(r),[]);
});

test("unmatched external partial refunds expose both orphan and repeated-return review",()=>{
  const s=base();
  s.external.push(
    {...returned("ORPHAN-R1","0.25"),transactionId:"ORPHAN"},
    {...returned("ORPHAN-R2","0.25"),transactionId:"ORPHAN"}
  );
  const r=reconcile(s);
  assert.deepEqual(codes(r),[
    "external_return_requires_review",
    "external_returns_exceed_capture",
    "multiple_return_events_require_review",
    "unmatched_external_transaction"
  ]);
  assert.equal(r.counts.exceptions,4);
});

test("missing provider transaction does not mask a recorded internal refund",()=>{
  const s=base();
  s.internalReturns=[recorded("0.25")];
  s.external=[];
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"missing_external_transaction");
  assert.deepEqual(codes(r),[
    "internal_return_not_externally_reported","missing_external_transaction"
  ]);
  assert.equal(r.totals.internallyRecordedReturns,"0.25");
});

test("unlinked local refund still requires independent return review",()=>{
  const s=base();
  s.internalReturns=[recorded("0.25")];
  s.links=[];
  s.external=[];
  const r=reconcile(s);
  assert.equal(r.rows[0].classification,"unlinked");
  assert.deepEqual(codes(r),[
    "internal_return_not_externally_reported","unlinked_internal_receipt"
  ]);
});
