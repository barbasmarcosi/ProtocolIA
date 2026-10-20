import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,cpSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {assertCreateDetails} from "../../packages/adapters/create-details.mjs";
const root="examples/vnext/dynamic-order-multi-edit";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
function compile(dir){return spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",dir],{
 encoding:"utf8",timeout:90000});}
test("B16 exposes two strictly audited independently authorized operations on the same detail resource",()=>{
 const run=compile(root);assert.equal(run.status,0,(run.stdout??"")+(run.stderr??""));
 const ir=JSON.parse(readFileSync(join(root,"tsp-output","@protocolia","compiler","ir.json"),"utf8"));
 const child=ir.entities.find(e=>e.name==="OrderLine");
 const edits=ir.operations.filter(o=>o.entity==="OrderLine"&&o.behavior.kind==="patchFields");
 assert.equal(edits.length,2);
 assert.deepEqual(new Set(edits.map(o=>o.behavior.field)),new Set(["units","product"]));
 assert.deepEqual(new Set(edits.map(o=>o.capability)),new Set(["lines.write","lines.product.write"]));
 for(const op of edits){
   assert.deepEqual(op.behavior.audit,[op.behavior.field]);
   assert.ok([200,400,401,403,404,409].every(status=>op.statuses.includes(status)));
 }
 const creator=ir.operations.find(o=>o.name==="createPurchaseOrder");
 assert.equal(assertCreateDetails(ir,ir.entities.find(e=>e.name==="PurchaseOrder"),creator).child.name,
   child.name);
});
function negative(label,transform,expected){
 const dir=mkdtempSync(join("examples/vnext",".b16-negative-"));
 try{
  cpSync(join(root,"contracts"),join(dir,"contracts"),{recursive:true});
  cpSync(join(root,"tspconfig.yaml"),join(dir,"tspconfig.yaml"));
  const changed=transform(source);assert.notEqual(changed,source,label);
  writeFileSync(join(dir,"contracts/main.tsp"),changed);
  const r=compile(dir);assert.notEqual(r.status,0,label);
  assert.match((r.stdout??"")+(r.stderr??""),expected,label);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test("B16 compiler fails closed on duplicate fields, shared caps and missing audit",()=>{
 negative("duplicate audited product",s=>s.replace(
  '@behavior("patchFields","OrderLine","units","units")',
  '@behavior("patchFields","OrderLine","product","product")'),
  /protocolia-detail-edit-duplicate|protocolia-invalid-audited-patch|protocolia-invalid-audit/);
 negative("shared capability",s=>s.replace(
  '@audit("product") @capability("lines.product.write")',
  '@audit("product") @capability("lines.write")'),/protocolia-detail-edit-duplicate/);
 negative("missing product audit",s=>s.replace(
  '@audit("product") @capability("lines.product.write")',
  '@capability("lines.product.write")'),/protocolia-detail-edit-lifecycle/);
 negative("FK editor",s=>s.replace(
  '@behavior("patchFields","OrderLine","product","product")',
  '@behavior("patchFields","OrderLine","orderCode","orderCode")'),
  /protocolia-invalid-audited-patch|protocolia-detail-edit-lifecycle|protocolia-invalid-audit/);
});
