import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {assertCreateDetails} from "../../packages/adapters/create-details.mjs";
const root="examples/vnext/dynamic-order-audited-append";
test("B17.2 direct child append is auditable in contract and rejected without mandatory parent",()=>{
  const compiled=spawnSync("node_modules/.bin/tsp",["compile",root],{encoding:"utf8",timeout:90000});
  assert.equal(compiled.status,0,compiled.stdout+"\n"+compiled.stderr);
  const ir=JSON.parse(readFileSync(root+"/tsp-output/@protocolia/compiler/ir.json","utf8"));
  const parent=ir.entities.find(x=>x.name==="PurchaseOrder");
  const create=ir.operations.find(x=>x.name==="createPurchaseOrder");
  const child=ir.operations.find(x=>x.name==="createOrderLine");
  assert.equal(create.capability,"orders.write");
  assert.equal(child.capability,"lines.write");
  assert.deepEqual(child.behavior.audit,["orderCode","product","units"]);
  assert.equal(assertCreateDetails(ir,parent,create).maxRows,20);
  for(const mutate of [
    copy=>{copy.operations.find(x=>x.name==="createOrderLine").behavior.audit=["product"]},
    copy=>{copy.operations.find(x=>x.name==="createOrderLine").behavior.audit=["lineCode","orderCode"]},
    copy=>{copy.operations.find(x=>x.name==="createOrderLine").behavior.audit=["orderCode","orderCode"]},
    copy=>{copy.operations.find(x=>x.name==="createOrderLine").behavior.audit=["orderCode","fake"]},
  ]){
    const bad=structuredClone(ir);mutate(bad);
    assert.throws(()=>assertCreateDetails(bad,parent,bad.operations.find(x=>x.name==="createPurchaseOrder")),
      /Unsafe bounded relational header\/detail contract/);
  }
});
