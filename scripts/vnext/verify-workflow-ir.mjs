import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ir=JSON.parse(readFileSync("examples/vnext/work-orders/tsp-output/@protocolia/compiler/ir.json","utf8"));
const entity=ir.entities.find(e=>e.name==="WorkOrder");
assert.equal(entity.fields.find(f=>f.name==="status").initial,"draft");
const t=ir.operations.filter(op=>op.behavior.kind==="transition");
assert.deepEqual(t.map(x=>[x.behavior.from,x.behavior.to]).sort(),
  [["approved","closed"],["draft","approved"]]);
for(const op of t){
  assert.equal(op.method,"POST");
  assert.equal(op.capability,"orders.write");
  assert.ok(op.statuses.includes(200)&&op.statuses.includes(409));
}
console.log("A6_TYPESPEC_GUARDED_WORKFLOW_IR_PASS");
