import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,cpSync,mkdirSync,rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve,join} from "node:path";
const root=resolve("examples/vnext/work-orders");
const original=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const cases=[
 ["read-capability",s=>s.replace('@capability("orders.audit")','@capability("orders.read")'),"protocolia-audit-query-capability"],
 ["writer-capability",s=>s.replace('@capability("orders.audit")','@capability("orders.write")'),"protocolia-audit-query-capability"],
 ["anonymous-audit",s=>s.replace('@capability("orders.audit")','@capability("public")'),"protocolia-audit-query-capability"],
 ["write-shaped-audit",s=>s.replace('@get @behavior("auditPage", "WorkOrder")','@post @behavior("auditPage", "WorkOrder")'),"protocolia-audit-query-http"]
];
const tmp=mkdtempSync(join(resolve("examples/vnext"),".a11-negative-"));
try{
 for(const [name,mutate,error] of cases){
  const dir=join(tmp,name);
  mkdirSync(join(dir,"contracts"),{recursive:true});
  cpSync(join(root,"tspconfig.yaml"),join(dir,"tspconfig.yaml"));
  const modified=mutate(original);
  assert.notEqual(modified,original);
  writeFileSync(join(dir,"contracts/main.tsp"),modified);
  const result=spawnSync(resolve("node_modules/.bin/tsp"),["compile",dir],{encoding:"utf8",timeout:120000});
  assert.notEqual(result.status,0,name+" must not compile");
  assert.match(result.stdout+"\n"+result.stderr,new RegExp(error),name);
 }
 console.log("A11_TYPESPEC_AUDIT_PRIVILEGE_SEPARATION_AND_READ_ONLY_ROUTE_REJECTED_PASS");
}finally{rmSync(tmp,{recursive:true,force:true});}
