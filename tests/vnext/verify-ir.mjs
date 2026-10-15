import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve("examples/vnext/taller/tsp-output");
const file = (sub,name) => readFileSync(resolve(root,sub,name),"utf8");
const raw = file("@protocolia/compiler","ir.json");
const ir = JSON.parse(raw);
const jdl = file("@protocolia/compiler","entities.jdl");
const plan = JSON.parse(file("@protocolia/compiler","jhipster-capability-report.json"));
const openapi = JSON.parse(file("@typespec/openapi3","openapi.json"));
const tool = ir.entities.find((entity)=>entity.name==="Tool");
assert.ok(tool,"no Tool entity in canonical IR");
assert.equal(tool.publicIdentity,"code");
assert.equal(tool.fields.find((f)=>f.name==="code").unique,true);
assert.equal(tool.fields.find((f)=>f.name==="quantity").min,0);
assert.equal(tool.fields.find((f)=>f.name==="lastReviewedAt").nullable,true);
assert.equal(tool.fields.find((f)=>f.name==="lastReviewedAt").required,false);
assert.deepEqual(ir.operations.map((op)=>op.name).sort(),
  ["createTool","getTool","health","increaseQuantity","listTools","renameTool"]);
for(const [name,method,path,capability,kind] of [
  ["createTool","POST","/api/tools","inventory.write","create"],
  ["getTool","GET","/api/tools/{code}","inventory.read","get"],
  ["listTools","GET","/api/tools","inventory.read","listPage"],
  ["increaseQuantity","PATCH","/api/tools/{code}/quantity","inventory.write","atomicIncrement"],
  ["renameTool","PATCH","/api/tools/{code}/name","inventory.write","patchFields"],
  ["health","GET","/health","public","health"],
]) {
  const op=ir.operations.find((x)=>x.name===name);
  assert.ok(op,name+" missing");
  assert.equal(op.method,method);
  assert.equal(op.path,path);
  assert.equal(op.capability,capability);
  assert.equal(op.behavior.kind,kind);
  assert.ok(openapi.paths[path]?.[method.toLowerCase()],name+" missing from OpenAPI");
}
assert.ok(jdl.includes("entity Tool {"));
assert.ok(jdl.includes("code String required unique"));
assert.ok(jdl.includes("quantity Integer required min(0)"));
assert.equal(plan.canEmitJdl,true);
assert.equal(plan.fullContractSupported,false,"unsupported business behavior must not be marked GO");
assert.ok(plan.blockers.some((b)=>b.code==="PUBLIC_IDENTITY_ADAPTER_UNVERIFIED"));
const hash=(text)=>createHash("sha256").update(text).digest("hex");
console.log("A0_REAL_TYPESPEC_IR_JDL_OPENAPI_ASSERTIONS_PASS");
console.log("A0_IR_SHA256="+hash(raw));
console.log("A0_JDL_SHA256="+hash(jdl));
console.log("A0_OPENAPI_SHA256="+hash(file("@typespec/openapi3","openapi.json")));
console.log("A0_DECLARED_JHIPSTER_FULL_CONTRACT_SUPPORTED="+plan.fullContractSupported);
