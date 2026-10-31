import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,cpSync,mkdtempSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {assertCreateDetails} from "../../packages/adapters/create-details.mjs";

const fixture=resolve("examples/vnext/workshop-itemized-guard");
const source=readFileSync(join(fixture,"contracts/main.tsp"),"utf8");
const decorator='@createDetails("ChargeLine","orderNumber","charges","amount","chargeTotal")';
function compile(folder){
  return spawnSync(resolve("node_modules/.bin/tsp"),["compile",folder],
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
  assert.ok(!ir.operations.some(op=>op.entity==="ChargeLine"&&
    ["patchFields","delete","replaceDetails","reassignReference"].includes(op.behavior.kind)));
  assert.ok(child.fields.find(x=>x.name==="amount")?.decimal);
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
  negative("wrong child amount",s=>s.replace(decorator,decorator.replace('"amount","chargeTotal"','"description","chargeTotal"')),/protocolia-invalid-create-details/);
  negative("wrong parent total",s=>s.replace(decorator,decorator.replace('"amount","chargeTotal"','"amount","symptom"')),/protocolia-invalid-create-details/);
  negative("unsafe source mismatch",s=>s.replace('"reversed","chargeTotal", true, true)','"reversed","available", true, true'),/protocolia-invalid-create-details|protocolia-invalid-exact-charge-source/);
  negative("client forged total",s=>s.replace('    // No scalar amount is accepted from the client.','    @encode(string) @exactDecimal(14,2,"0","999999999999.99") chargeTotal: decimal;\n    // No scalar amount is accepted from the client.'),/protocolia-invalid-create-details|protocolia-server-only-request-spoof/);
  negative("no itemization authorization",s=>s.replace(decorator,'@createDetails("ChargeLine","orderNumber","charges")'),/protocolia-invalid-create-details|protocolia-decimal-request-mismatch/);
  negative("extra row source",s=>s.replace('    amount: decimal;\n  }\n  model ChargeLineInput {','    amount: decimal;\n    @minValue(1) extra:int32;\n  }\n  model ChargeLineInput {'),/protocolia-invalid-create-details/);
});
