import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,cpSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {buildQueryPlan} from "../../packages/adapters/query-plan.mjs";
const root="examples/vnext/dynamic-order-read";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
function compile(dir){return spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),
  ["compile",dir],{encoding:"utf8",timeout:90000});}
test("B13 contract emits typed FK-filtered child query and B12 dynamic create",()=>{
 const result=compile(root);assert.equal(result.status,0,(result.stdout??"")+(result.stderr??""));
 const ir=JSON.parse(readFileSync(join(root,"tsp-output","@protocolia","compiler","ir.json"),"utf8"));
 const query=ir.operations.find(x=>x.name==="queryOrderLines");
 assert.ok(query);assert.equal(query.behavior.kind,"queryPage");
 assert.deepEqual(query.behavior.filters,[{
  parameter:"orderCode",field:"orderCode",operator:"eq",type:"string"
 }]);
 assert.deepEqual(query.behavior.sort,{field:"lineCode",direction:"asc"});
 const plan=buildQueryPlan(ir,query);
 assert.ok(plan,"SQL plan required");
 assert.equal(ir.operations.find(x=>x.name==="createPurchaseOrder").behavior.createDetails.childEntity,"OrderLine");
});
function invalid(label,transform){
 const temp=mkdtempSync(join("examples/vnext",".b13-negative-"));
 try{
  cpSync(join(root,"contracts"),join(temp,"contracts"),{recursive:true});
  cpSync(join(root,"tspconfig.yaml"),join(temp,"tspconfig.yaml"));
  const modified=transform(source);assert.notEqual(modified,source,label);
  writeFileSync(join(temp,"contracts/main.tsp"),modified);
  const result=compile(temp);
  assert.notEqual(result.status,0,label);
  assert.match((result.stdout??"")+(result.stderr??""),
   /protocolia-query-filter|protocolia-query-shape|protocolia-query-http/,label);
 }finally{rmSync(temp,{recursive:true,force:true});}
}
test("B13 query fails closed for nonexistent FK path and unsupported comparison",()=>{
 invalid("unknown filter",s=>s.replace('@queryFilter("orderCode","eq")','@queryFilter("missing","eq")'));
 invalid("type mismatch",s=>s.replace('@queryFilter("orderCode","eq")','@queryFilter("units","gte")'));
 invalid("missing deterministic order",s=>s.replace('@queryOrder("lineCode","asc")',''));
});
