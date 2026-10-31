import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,cpSync,mkdtempSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {assertCreateDetails} from "../../packages/adapters/create-details.mjs";
import {compileExactReconciliations,exactAdjustmentJournalSql} from "../../packages/adapters/exact-reconciliation.mjs";
import {exactAdjustmentWriteSql,assertExactAdjustment,assertExactAdjustmentLookup} from "../../packages/adapters/exact-adjustment.mjs";

const fixture=resolve("examples/vnext/workshop-itemized-guard");
const source=readFileSync(join(fixture,"contracts/main.tsp"),"utf8");
const decorator='@createDetails("ChargeLine","orderNumber","charges","amount","chargeTotal")';
function compile(folder){
  return spawnSync(resolve("node_modules/.bin/tsp"),["compile",folder,"--pretty","false"],
    {encoding:"utf8",timeout:90000,maxBuffer:4*1024*1024});
}
test("S2b TypeSpec binds immutable nested exact charge rows to one authoritative source",()=>{
  const run=compile(fixture);
  assert.equal(run.status,0,(run.stdout??"")+"\n"+(run.stderr??""));
  const ir=JSON.parse(readFileSync(join(fixture,"tsp-output/@protocolia/compiler/ir.json"),"utf8"));
  const order=ir.operations.find(x=>x.name==="createWorkOrder");
  const parent=ir.entities.find(x=>x.name==="WorkOrder");
  assert.ok(order&&parent);
  assert.deepEqual(order.behavior.createDetails,{
    childEntity:"ChargeLine",parentField:"orderNumber",rowsField:"charges",maxRows:20,
    chargeAmountField:"amount",chargeTotalField:"chargeTotal"
  });
  const plan=assertCreateDetails(ir,parent,order);
  assert.equal(plan.chargeAmountField,"amount");
  assert.equal(plan.chargeTotalField,"chargeTotal");
  const recon=ir.operations.find(x=>x.name==="reconcileWorkOrder");
  assert.deepEqual(recon.behavior.reconcileExact.chargeSource,"chargeTotal");
  const child=ir.entities.find(x=>x.name==="ChargeLine");
  const payment=ir.entities.find(x=>x.name==="Payment");
  const providerState=payment?.fields.find(x=>x.name==="providerSettlementState");
  assert.equal(providerState?.initial,"unverified");
  assert.equal(providerState?.fixedInitial,true);
  assert.equal(providerState?.type,"string");
  assert.equal(providerState?.minLength,10);
  assert.equal(providerState?.maxLength,10);
  assert.ok(!ir.operations.some(op=>op.entity==="Payment"&&
    ["patchFields","patchTogether","transition","delete"].includes(op.behavior.kind)&&
    (op.behavior.field==="providerSettlementState"||op.behavior.kind==="delete")),
    "External settlement must have no writable lifecycle before provider integration");
  assert.ok(!ir.operations.some(op=>op.entity==="ChargeLine"&&
    ["patchFields","delete","replaceDetails","reassignReference"].includes(op.behavior.kind)));
  assert.ok(child.fields.find(x=>x.name==="amount")?.decimal);
  // One source-backed snapshot must reject a journal balanced against a
  // persisted but no longer matching child-row sum.
  const sql=compileExactReconciliations(ir).get("reconcileWorkOrder");
  assert.equal(recon.behavior.reconcileExact.adjustmentPreview,true);
  assert.equal(recon.behavior.reconcileExact.adjustmentJournal,true);
  assert.equal(recon.behavior.reconcileExact.unverifiedProofField,"providerSettlementState");
  const journal=exactAdjustmentJournalSql(compileExactReconciliations(ir));
  const adjOp=ir.operations.find(x=>x.name==="adjustWorkOrder");
  assert.ok(adjOp);
  assert.equal(adjOp.behavior.kind,"adjustExact");
  assert.equal(adjOp.capability,"orders.adjust");
  const lookup=ir.operations.find(x=>x.name==="lookupWorkOrderAdjustment");
  assert.equal(lookup?.behavior.kind,"lookupExactAdjustment");
  assert.equal(lookup.capability,adjOp.capability);
  assert.equal(lookup.method,"GET");
  assert.equal(lookup.path,adjOp.path+"/{adjustmentId}");
  const api=JSON.parse(readFileSync(join(fixture,
    "tsp-output/@typespec/openapi3/openapi.json"),"utf8"));
  assert.equal(assertExactAdjustmentLookup(ir,api,lookup,compileExactReconciliations(ir)).table,
    "protocolia_exact_adjustment_work_order");
  const tamperOutcome=(change)=>{
    const invalid=structuredClone(api);
    const ref=invalid.paths[lookup.path].get.responses["200"]
      .content["application/json"].schema.$ref;
    assert.ok(ref,"Outcome must have a concrete OpenAPI schema reference");
    const model=ref.split("/").slice(1).reduce((v,key)=>v[key],invalid);
    change(model);
    assert.throws(()=>assertExactAdjustmentLookup(ir,invalid,lookup,
      compileExactReconciliations(ir)),/Invalid immutable adjustment outcome lookup/);
  };
  tamperOutcome(model=>{model.properties.actor={type:"string"};model.required.push("actor");});
  tamperOutcome(model=>{model.properties.delta={type:"number",format:"double"};});
  tamperOutcome(model=>{model.properties.status={type:"string",enum:["pending","committed"]};});
  const writeSql=exactAdjustmentWriteSql(ir,compileExactReconciliations(ir));
  assert.equal(writeSql.length,1);
  assert.match(writeSql[0],/FOR UPDATE/);
  assert.match(writeSql[0],/IF NOT COALESCE\(v_balanced,false\)/);
  assert.match(writeSql[0],/v_review_posting<>v_expected_posting/);
  assert.match(writeSql[0],/v_review_adjustments<>v_expected_adjustments/);
  assert.match(writeSql[0],/Reviewed ledger snapshot changed/);
  assert.match(writeSql[0],/INSERT INTO protocolia_exact_adjustment_work_order/);
  assert.match(writeSql[0],/UPDATE work_order SET charge_total=v_new_charge/);
  assert.match(writeSql[0],/INSERT INTO protocolia_audit_event/);
  assert.equal(journal.length,3);
  assert.match(journal[0],/CREATE TABLE protocolia_exact_adjustment_work_order/);
  assert.match(journal[0],/delta NUMERIC\(14,2\) NOT NULL CHECK \(delta <> 0\)/);
  assert.match(journal[0],/PRIMARY KEY \(parent_id, adjustment_id\)/);
  assert.match(journal[0],/UNIQUE \(adjustment_id\)/,
    "A correction ID must not be reused against a different order");
  assert.match(journal[1],/RAISE EXCEPTION/);
  assert.match(journal[2],/BEFORE UPDATE OR DELETE/);
  assert.ok(sql&&sql.sqlNest===sql.sqlSpring.replace(":identity","$1"));
  assert.match(sql.sqlNest,/LEFT JOIN LATERAL \(SELECT COUNT\(\*\) AS line_count/);
  assert.match(sql.sqlNest,/SUM\(d\.amount\) AS line_total FROM charge_line/);
  assert.match(sql.sqlNest,/COALESCE\(s\.line_count,0\) BETWEEN 1 AND 20/);
  assert.match(sql.sqlNest,/\(COALESCE\(s\.line_total,0\)\+COALESCE\(a\.adjustment_total,0\)\)=p\.charge_total/);
  assert.match(sql.sqlNest,/p\.opening_balance=p\.charge_total/);
  assert.match(sql.sqlNest,/CASE WHEN NOT/);
  assert.match(sql.sqlNest,/SUM\(a0\.delta\) AS adjustment_total/);
  assert.match(sql.sqlNest,/COALESCE\(a.adjustment_count,0\) BETWEEN 0 AND 100/);
  assert.match(sql.sqlNest,/COALESCE\(s.line_total,0\)\+COALESCE\(a.adjustment_total,0\)/);
  assert.match(sql.sqlNest,/AS "maxSafeDecrease"/);
  assert.match(sql.sqlNest,/AS "maxSafeIncrease"/);
  assert.match(sql.sqlNest,/AS "adjustmentPreviewEligible"/);
  assert.match(sql.sqlNest,/AS "adjustmentCount"/);
  assert.match(sql.sqlNest,/AS "unverifiedPostedTotal"/);
  assert.match(sql.sqlNest,/AS "unverifiedPostingCount"/);
  assert.match(sql.sqlNest,/c\.provider_settlement_state='unverified'/);
  const proofTamper=structuredClone(ir);
  proofTamper.entities.find(x=>x.name==="Payment").fields
    .find(x=>x.name==="providerSettlementState").fixedInitial=false;
  assert.throws(()=>compileExactReconciliations(proofTamper),
    /Invalid unverified provider proof binding/);
  const poisonedMax=structuredClone(ir);
  poisonedMax.entities.find(x=>x.name==="WorkOrder").fields
    .find(x=>x.name==="chargeTotal").decimal.max="0;DROP TABLE payment";
  assert.throws(()=>compileExactReconciliations(poisonedMax),
    /Invalid exact repricing preview/);
  const noPreview=structuredClone(ir);
  noPreview.operations.find(x=>x.name==="createWorkOrder")
    .behavior.createDetails.chargeAmountField=undefined;
  assert.throws(()=>compileExactReconciliations(noPreview),/Invalid exact repricing preview/);
  const sourceTampering=structuredClone(ir);
  sourceTampering.operations.find(x=>x.name==="createWorkOrder")
    .behavior.createDetails.chargeTotalField="available";
  assert.throws(()=>compileExactReconciliations(sourceTampering),
    /Invalid exact itemized source binding/);
  const wrongSource=structuredClone(ir);
  wrongSource.operations.find(x=>x.name==="reconcileWorkOrder")
    .behavior.reconcileExact.chargeSource="available";
  assert.throws(()=>assertCreateDetails(wrongSource,parent,order),
    /Unsafe bounded relational header\/detail contract/);
});
function negative(label,mutate,expected){
  const tmp=mkdtempSync(resolve("examples/vnext/.itemized-negative-"));
  try{
    cpSync(join(fixture,"contracts"),join(tmp,"contracts"),{recursive:true});
    cpSync(join(fixture,"tspconfig.yaml"),join(tmp,"tspconfig.yaml"));
    const next=mutate(source);
    assert.notEqual(next,source,label+" must modify the fixture");
    writeFileSync(join(tmp,"contracts/main.tsp"),next);
    const result=compile(tmp);
    assert.notEqual(result.status,0,label+" must fail closed");
    assert.match((result.stdout??"")+"\n"+(result.stderr??""),expected,label);
  }finally{rmSync(tmp,{recursive:true,force:true});}
}
test("S2b compiler refuses missing linked source, missing field, spoofing and ordinary unsafe mutations",()=>{
  assert.ok(source.includes(decorator));
  negative("unverified projection requires immutable proof",s=>s.replace(
    '@fixedInitial("unverified")','@initial("unverified")'),/protocolia-(?:invalid-unverified-proof|orphan-initial)/);
  negative("unverified projection rejects unrelated child field",s=>s.replace(
    'true, "providerSettlementState")','true, "destinationAccount")'),
    /protocolia-invalid-unverified-proof/);
  negative("unverified projection rejects missing child field",s=>s.replace(
    'true, "providerSettlementState")','true, "doesNotExist")'),
    /protocolia-invalid-unverified-proof/);
  negative("fixed provider proof cannot be ordinary state",s=>s.replace(
    '@fixedInitial("unverified")','@initial("unverified")'),/protocolia-orphan-initial/);
  negative("provider proof cannot be a client lifecycle",s=>s.replace(
    '  @route("/health")',
    '  @route("/api/payments/{receipt}/provider-settle")\n'+
    '  @post @behavior("transition","Payment","providerSettlementState")\n'+
    '  @transition("unverified","settled") @audit("providerSettlementState") @capability("payments.write")\n'+
    '  op providerSettle(@path receipt: string): Payment | Conflict | NotFound | Unauthorized | Forbidden;\n'+
    '  @route("/health")'),/protocolia-invalid-(?:fixed-initial|transition)/);
  negative("lookup privilege escalation",s=>s.replace(
    '@behavior("lookupExactAdjustment","WorkOrder") @capability("orders.adjust")',
    '@behavior("lookupExactAdjustment","WorkOrder") @capability("orders.read")'),
    /protocolia-invalid-exact-adjustment-lookup/);
  negative("lookup cannot be POST",s=>s.replace(
    '@get @behavior("lookupExactAdjustment","WorkOrder")',
    '@post @behavior("lookupExactAdjustment","WorkOrder")'),
    /protocolia-invalid-exact-adjustment-lookup/);
  negative("lookup cannot leak extra route parameter",s=>s.replace(
    'adjustments/{adjustmentId}")',
    'adjustments/{adjustmentId}/{actor}")'),
    /protocolia-invalid-exact-adjustment-lookup|missing-(?:route|uri)-param/);
  negative("missing reviewed adjustment count",s=>s.replace(
    '    @minLength(1) @maxLength(3) expectedAdjustmentCount: string;',
    ''),/protocolia-invalid-exact-adjustment/);
  negative("forged floating-point reviewed balance",s=>s.replace(
    '@encode(string) @exactDecimal(14,2,"0.00","999999999999.99") expectedAvailable: decimal;',
    'expectedAvailable: float64;'),/protocolia-invalid-exact-adjustment/);
  negative("optional reviewed posting count",s=>s.replace(
    'expectedPostingCount: string;',
    'expectedPostingCount?: string;'),/protocolia-invalid-exact-adjustment/);
  negative("forged adjustment actor",s=>s.replace(
    '    @minLength(12) @maxLength(240) reason: string;',
    '    @minLength(12) @maxLength(240) reason: string;\n    actor: string;'),
    /protocolia-invalid-exact-adjustment/);
  negative("adjustment authority reuses read",s=>s.replace(
    '@behavior("adjustExact","WorkOrder") @capability("orders.adjust")',
    '@behavior("adjustExact","WorkOrder") @capability("orders.read")'),
    /protocolia-invalid-exact-adjustment/);
  negative("disabled adjustment journal",s=>s.replace(
    '"reversed","chargeTotal", true, true, true, true, "providerSettlementState")',
    '"reversed","chargeTotal", true, true, true, false, "providerSettlementState")'),
    /protocolia-invalid-exact-adjustment-journal/);
  negative("journal without preview",s=>s.replace(
    '"reversed","chargeTotal", true, true, true, true, "providerSettlementState")',
    '"reversed","chargeTotal", true, true, false, true, "providerSettlementState")'),
    /protocolia-invalid-exact-adjustment-journal/);
  negative("disabled repricing preview",s=>s.replace(
    '"reversed","chargeTotal", true, true, true, true, "providerSettlementState")',
    '"reversed","chargeTotal", true, true, false, true, "providerSettlementState")'),
    /protocolia-invalid-exact-adjustment-preview/);
  negative("missing amount ceiling",s=>s.replace(
    '@exactDecimal(14,2,"0","999999999999.99")\n    chargeTotal',
    '@exactDecimal(14,2,"0")\n    chargeTotal'),
    /protocolia-invalid-exact-adjustment-preview/);
  negative("wrong child amount",s=>s.replace(decorator,decorator.replace('"amount","chargeTotal"','"description","chargeTotal"')),/protocolia-invalid-create-details/);
  negative("wrong parent total",s=>s.replace(decorator,decorator.replace('"amount","chargeTotal"','"amount","symptom"')),/protocolia-invalid-create-details/);
  negative("client forged total",s=>s.replace('    // No scalar amount is accepted from the client.','    @encode(string) @exactDecimal(14,2,"0","999999999999.99") chargeTotal: decimal;\n    // No scalar amount is accepted from the client.'),/protocolia-invalid-create-details|protocolia-server-only-request-spoof/);
  negative("no itemization authorization",s=>s.replace(decorator,'@createDetails("ChargeLine","orderNumber","charges")'),/protocolia-invalid-create-details|protocolia-decimal-request-mismatch/);
  negative("extra row source",s=>s.replace('    amount: decimal;\n  }\n  model ChargeLineInput {','    amount: decimal;\n    @minValue(1) extra:int32;\n  }\n  model ChargeLineInput {'),/protocolia-invalid-create-details/);
});
