import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,cpSync,mkdirSync,rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve,join} from "node:path";
const root=resolve("examples/vnext/work-orders");
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const variants=[
 ["unknown",x=>x.replace('@audit("title,status")','@audit("password")')],
 ["duplicate",x=>x.replace('@audit("title,status")','@audit("status,status")')],
 ["read",x=>x.replace('@behavior("get", "WorkOrder") @capability("orders.read")',
   '@behavior("get", "WorkOrder") @audit("status") @capability("orders.read")')],
 ["transition",x=>x.replace('@transition("draft", "approved")\n  @audit("status")',
   '@transition("draft", "approved")\n  @audit("title")')]
];
const tmp=mkdtempSync(join(resolve("examples/vnext"),".a10-audit-negative-"));
try{
 for(const [name,mutate] of variants){
   const dir=join(tmp,name);mkdirSync(join(dir,"contracts"),{recursive:true});
   cpSync(join(root,"tspconfig.yaml"),join(dir,"tspconfig.yaml"));
   const invalid=mutate(source);
   assert.notEqual(invalid,source);
   writeFileSync(join(dir,"contracts/main.tsp"),invalid);
   const test=spawnSync(resolve("node_modules/.bin/tsp"),["compile",dir],
     {encoding:"utf8",timeout:120000});
   assert.notEqual(test.status,0,name+" invalid audit unexpectedly compiled");
   assert.match(test.stdout+"\n"+test.stderr,/protocolia-invalid-audit/);
 }
 console.log("A10_INVALID_TYPE_SPEC_AUDIT_ALLOWLIST_REJECTED_PASS");
}finally{rmSync(tmp,{recursive:true,force:true});}
