import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root="examples/vnext/gauge/tsp-output";
const ir=JSON.parse(readFileSync(root+"/@protocolia/compiler/ir.json","utf8"));
const spec=JSON.parse(readFileSync(root+"/@typespec/openapi3/openapi.json","utf8"));
const entity=ir.entities.find(e=>e.name==="Gauge");
assert.ok(entity,"Gauge entity not emitted");
assert.equal(entity.publicIdentity,"serial");
assert.equal(entity.fields.find(f=>f.name==="reading")?.min,0);
assert.equal(entity.fields.find(f=>f.name==="calibratedAt")?.nullable,true);
assert.equal(entity.fields.find(f=>f.name==="label")?.maxLength,90);
assert.ok(ir.operations.every(o=>o.entity==="Gauge"));
assert.deepEqual(ir.operations.map(o=>o.behavior.kind).sort(),
  ["atomicIncrement","create","get","health","listPage","patchFields"]);
for(const [method,path] of [["post","/api/gauges"],["get","/api/gauges/{serial}"],
  ["get","/api/gauges"],["patch","/api/gauges/{serial}/reading"],
  ["patch","/api/gauges/{serial}/label"],["get","/health"]]){
  assert.ok(spec.paths[path]?.[method],"Missing "+method+" "+path);
}
assert.ok(!JSON.stringify(ir).includes('"Tool"'),"IR must not contain first fixture");
console.log("A0_INDEPENDENT_TYPESPEC_GAUGE_IR_OPENAPI_PASS");
