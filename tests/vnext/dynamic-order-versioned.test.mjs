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
    childEntity:"OrderLine",parentField:"orderCode",rowsField:"lines",maxRows:20,versioned:true,
    closeField:"status",closeState:"closed"
  });
  assert.equal(assertCreateDetails(ir,parent,creator).maxRows,20);
  const replacement=ir.operations.find(x=>x.name==="replaceOrderLines");
  assert.ok(replacement,"Bulk replacement must be part of canonical IR");
  assert.equal(replacement.behavior.kind,"replaceDetails");
  assert.equal(replacement.method,"PUT");
  assert.equal(replacement.path,"/api/orders/{code}/lines");
  assert.deepEqual(replacement.statuses,[200,400,401,403,404,409]);
  assert.equal(replacement.capability,creator.capability);
  const close=ir.operations.find(x=>x.name==="closePurchaseOrder");
  assert.ok(close);
  assert.equal(close.behavior.kind,"transition");
  assert.equal(close.behavior.field,"status");
  assert.equal(close.behavior.to,"closed");
  assert.deepEqual(close.behavior.audit,["status"]);
  assert.equal(close.capability,creator.capability);
  const child=ir.operations.find(x=>x.name==="createOrderLine");
  assert.ok(child.behavior.audit.includes("orderCode"));
  for(const name of ["createOrderLine","patchLineProduct","patchLineUnits","deleteOrderLine"]){
    const op=ir.operations.find(x=>x.name===name);
    assert.ok(op);
    assert.ok(["POST","PATCH","DELETE"].includes(op.method));
  }
  const del=ir.operations.find(x=>x.name==="deleteOrderLine");
  assert.equal(del.method,"DELETE");
  assert.deepEqual(del.behavior.audit,["orderCode","product","units"]);
  const malformed=structuredClone(ir);
  malformed.operations.find(x=>x.name==="deleteOrderLine").behavior.audit=["product"];
  assert.throws(()=>assertCreateDetails(malformed,parent,malformed.operations.find(x=>x.name==="createPurchaseOrder")),
    /Unsafe bounded relational header\/detail contract/);
  const unsafe=structuredClone(ir);
  unsafe.operations.find(x=>x.name==="createOrderLine").behavior.audit=undefined;
  assert.throws(()=>assertCreateDetails(unsafe,parent,unsafe.operations.find(x=>x.name==="createPurchaseOrder")),
    /Unsafe bounded relational header\/detail contract/);
});
