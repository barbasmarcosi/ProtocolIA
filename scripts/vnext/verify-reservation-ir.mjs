import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const dir="examples/vnext/inventory-reservations/tsp-output/@protocolia/compiler/ir.json";
const ir=JSON.parse(readFileSync(dir,"utf8"));
const op=ir.operations.find(o=>o.name==="createAllocation");
assert.equal(op.behavior.kind,"create");
assert.deepEqual(op.behavior.reserve,{
  stockEntity:"Part",availableField:"available",referenceField:"partSku",quantityField:"units"
});
assert.ok(op.statuses.includes(201)&&op.statuses.includes(400)&&op.statuses.includes(409));
assert.equal(ir.entities.find(e=>e.name==="Allocation").fields.find(f=>f.name==="partSku").reference.target,"Part");
const cancel=ir.operations.find(o=>o.name==="cancelAllocation");
assert.equal(cancel.behavior.kind,"transition");
assert.equal(cancel.behavior.field,"status");
assert.equal(cancel.behavior.from,"active");
assert.equal(cancel.behavior.to,"cancelled");
assert.deepEqual(cancel.behavior.release,op.behavior.reserve);
assert.equal(ir.entities.find(e=>e.name==="Allocation").fields.find(f=>f.name==="status").initial,"active");
console.log("A8_TYPESPEC_COMPENSATING_RELEASE_IR_PASS");
console.log("A7_TYPESPEC_TRANSACTIONAL_RESERVATION_IR_PASS");
