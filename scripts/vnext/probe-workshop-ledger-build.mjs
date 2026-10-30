#!/usr/bin/env node
// Structural conformance for one frozen workshop business contract.
// Do not read this program to define the business requirements: use the frozen brief.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
const root=resolve(process.argv[2]??"");
const info=JSON.parse(readFileSync(join(root,"protocolia-build.json"),"utf8"));
assert.ok(["nestjs","modular-spring"].includes(info.target));
const bytes=readFileSync(join(root,"protocolia-contract-ir.json"));
assert.equal(createHash("sha256").update(bytes).digest("hex"),info.irSha256);
const ir=JSON.parse(bytes);
const uiPath=info.target==="nestjs"?"dist/static/protocolia-ui.json":
  "src/main/resources/static/protocolia-ui.json";
const ui=JSON.parse(readFileSync(join(root,uiPath),"utf8"));
const resources=ui.resources??[];
assert.deepEqual(resources.map(r=>r.entity.name).sort(),
  ["Customer","Payment","Vehicle","WorkOrder"]);
const byName=new Map(resources.map(r=>[r.entity.name,r]));
for(const [source,field,target] of [
  ["Vehicle","customerCode","Customer"],
  ["WorkOrder","vehiclePlate","Vehicle"],
  ["Payment","orderNumber","WorkOrder"]
]){
  assert.equal(byName.get(source).entity.fields.find(f=>f.name===field)?.reference?.target,
    target,"Lost business FK "+source+"."+field);
}
assert.equal(byName.get("WorkOrder").entity.fields.find(f=>f.name==="laborCharge")?.type,"decimal");
assert.equal(byName.get("Payment").entity.fields.find(f=>f.name==="amount")?.type,"decimal");
assert.ok(byName.get("Payment").entity.fields.find(f=>f.name==="method")?.choices?.length===3);
assert.ok(byName.get("WorkOrder").operations.queryPage);
assert.ok(byName.get("WorkOrder").operations.auditPage);
assert.deepEqual((byName.get("WorkOrder").transitions??[]).map(t=>t.behavior.to).sort(),
  ["finished","underway"]);
assert.equal(ir.operations.length,21);
console.log("PROTOCOLIA_V12_WORKSHOP_LEDGER_BUILD_PASS "+JSON.stringify({
  target:info.target,resources:resources.length,contractHash:info.contractSha256,
  irHash:info.irSha256,foreignKeys:3
}));
