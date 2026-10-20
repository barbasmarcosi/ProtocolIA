import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {assertCreateDetails} from "../../packages/adapters/create-details.mjs";

const root="examples/vnext/dynamic-order-versioned";
test("B17.3 @versionedDetails opt-in emits parent CAS and strong If-Match child operations",()=>{
  const c=spawnSync("node_modules/.bin/tsp",["compile",root],{encoding:"utf8",timeout:120000});
  assert.equal(c.status,0,c.stdout+"\n"+c.stderr);
  const ir=JSON.parse(readFileSync(root+"/tsp-output/@protocolia/compiler/ir.json","utf8"));
  const parent=ir.entities.find(x=>x.name==="PurchaseOrder");
  const creator=ir.operations.find(x=>x.name==="createPurchaseOrder");
  assert.deepEqual(creator.behavior.createDetails,{
    childEntity:"OrderLine",parentField:"orderCode",rowsField:"lines",maxRows:20,versioned:true
  });
  assert.equal(assertCreateDetails(ir,parent,creator).maxRows,20);
  const child=ir.operations.find(x=>x.name==="createOrderLine");
  assert.ok(child.behavior.audit.includes("orderCode"));
  for(const name of ["createOrderLine","patchLineProduct","patchLineUnits"]){
    const op=ir.operations.find(x=>x.name===name);
    assert.ok(op);
    assert.ok(["POST","PATCH"].includes(op.method));
  }
  const unsafe=structuredClone(ir);
  unsafe.operations.find(x=>x.name==="createOrderLine").behavior.audit=undefined;
  assert.throws(()=>assertCreateDetails(unsafe,parent,unsafe.operations.find(x=>x.name==="createPurchaseOrder")),
    /Unsafe bounded relational header\/detail contract/);
});
