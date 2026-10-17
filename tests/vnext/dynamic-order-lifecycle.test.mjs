import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,cpSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {compileDetailSums} from "../../packages/adapters/detail-sum.mjs";
const root="examples/vnext/dynamic-order-lifecycle";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
function compile(dir){return spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),
 ["compile",dir],{encoding:"utf8",timeout:90000});}
test("B14 TypeSpec derives one full server-side sum plus optimistic audited child PATCH",()=>{
 const run=compile(root);
 assert.equal(run.status,0,(run.stdout??"")+(run.stderr??""));
 const ir=JSON.parse(readFileSync(join(root,"tsp-output","@protocolia","compiler","ir.json"),"utf8"));
 const total=ir.operations.find(o=>o.name==="totalUnits");
 assert.equal(total.behavior.kind,"sumDetails");
 assert.deepEqual(total.behavior.detailSum,{
  childEntity:"OrderLine",parentField:"orderCode",quantityField:"units"});
 const plan=compileDetailSums(ir).get("totalUnits");
 assert.ok(plan.sqlNest.includes("SUM(c.units::bigint)"));
 assert.ok(plan.sqlNest.includes("LEFT JOIN order_line"));
 const patch=ir.operations.find(o=>o.name==="patchLineProduct");
 assert.deepEqual(patch.behavior.audit,["product"]);
 assert.equal(patch.behavior.field,"product");
 assert.ok([200,400,401,403,404,409].every(n=>patch.statuses.includes(n)));
 const unsafe=structuredClone(ir);
 unsafe.entities.find(e=>e.name==="OrderLine").fields.find(f=>f.name==="orderCode").reference=undefined;
 assert.throws(()=>compileDetailSums(unsafe),/Unsafe/);
});
function negative(label,transform,expected){
 const dir=mkdtempSync(join("examples/vnext",".b14-negative-"));
 try{
  cpSync(join(root,"contracts"),join(dir,"contracts"),{recursive:true});
  cpSync(join(root,"tspconfig.yaml"),join(dir,"tspconfig.yaml"));
  const changed=transform(source);assert.notEqual(changed,source,label);
  writeFileSync(join(dir,"contracts/main.tsp"),changed);
  const run=compile(dir);assert.notEqual(run.status,0,label);
  assert.match((run.stdout??"")+(run.stderr??""),expected,label);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test("B14 fails closed on forged aggregate, weakened CAS and unaudited mutable child",()=>{
 negative("quantity field wrong",s=>s.replace(
  '@detailSum("OrderLine","orderCode","units")',
  '@detailSum("OrderLine","orderCode","product")'),/protocolia-invalid-detail-sum/);
 negative("forged relation",s=>s.replace(
  '@detailSum("OrderLine","orderCode","units")',
  '@detailSum("OrderLine","product","units")'),/protocolia-invalid-detail-sum/);
 negative("widened product DTO",s=>s.replace(
  'model ProductChange { @minLength(1) @maxLength(120) product:string;',
  'model ProductChange { @minLength(1) @maxLength(200) product:string;'),
  /protocolia-invalid-audited-patch/);
 negative("missing expected",s=>s.replace(
  '    @minLength(1) @maxLength(120) expected:string;',''),
  /protocolia-invalid-audited-patch/);
 negative("unaudited child edit",s=>s.replace(
  '  @audit("product") @capability("lines.write")',
  '  @capability("lines.write")'),/protocolia-|error/);
});
