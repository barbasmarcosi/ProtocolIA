import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,cpSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
const root="examples/vnext/composite-key-patch";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
function negative(label,fn,code){
  const dir=mkdtempSync(join("examples/vnext",".b4-negative-"));
  try{
    cpSync(join(root,"contracts"),join(dir,"contracts"),{recursive:true});
    cpSync(join(root,"tspconfig.yaml"),join(dir,"tspconfig.yaml"));
    const edited=fn(source);
    assert.notEqual(edited,source,label);
    writeFileSync(join(dir,"contracts/main.tsp"),edited);
    const run=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",dir],
      {encoding:"utf8",timeout:90000});
    assert.notEqual(run.status,0,label+" must fail to compile");
    assert.match((run.stderr??"")+(run.stdout??""),code,label);
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test("composite-key PATCH retains type, bounds and conflict in the IR",()=>{
  const path=join(root,"tsp-output/@protocolia/compiler/ir.json");
  const ir=JSON.parse(readFileSync(path,"utf8"));
  const inspection=ir.entities.find(e=>e.name==="Inspection");
  assert.deepEqual(inspection.uniqueTogether,["equipmentCode","period"]);
  const operation=ir.operations.find(x=>x.name==="updateInspectionPeriod");
  assert.equal(operation.behavior.kind,"patchFields");
  assert.equal(operation.behavior.field,"period");
  assert.equal(operation.behavior.input,"period");
  assert.equal(operation.method,"PATCH");
  for(const status of [200,400,404,409])assert.ok(operation.statuses.includes(status));
});
test("compound-key PATCH cannot omit 409 or weaken DTO constraints",()=>{
  negative("missing 409",s=>s.replace(
    'Inspection | BadRequest | Conflict | NotFound | Unauthorized | Forbidden;',
    'Inspection | BadRequest | NotFound | Unauthorized | Forbidden;'),
    /protocolia-unique-together-patch-invalid/);
  negative("missing DTO field",s=>s.replace(
    'model InspectionPeriodUpdate {\n    @minLength(7) @maxLength(7)\n    period: string;',
    'model InspectionPeriodUpdate {\n    @minLength(7) @maxLength(7)\n    alternate: string;'),
    /protocolia-unique-together-patch-invalid/);
  negative("DTO weakened",s=>s.replace(
    'model InspectionPeriodUpdate {\n    @minLength(7) @maxLength(7)',
    'model InspectionPeriodUpdate {\n    @minLength(1) @maxLength(7)'),
    /protocolia-unique-together-patch-invalid/);
});
test("ordinary PATCH cannot masquerade as a compound FK reassignment",()=>{
  negative("FK key as ordinary patch",s=>s.replace(
    '@behavior("patchFields","Inspection","period","period")',
    '@behavior("patchFields","Inspection","equipmentCode","period")'),
    /protocolia-unique-together-patch-invalid/);
});
