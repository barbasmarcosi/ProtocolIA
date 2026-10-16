import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {compileOwnerScopes} from "../../packages/adapters/owner-scope.mjs";
const root="examples/vnext/owner-scope";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const ir=JSON.parse(readFileSync(join(root,"tsp-output/@protocolia/compiler/ir.json"),"utf8"));
test("S1a scope maps server-managed field and isolated operations",()=>{
 const e=ir.entities.find(x=>x.name==="PrivateNote");
 assert.equal(e.fields.filter(f=>f.ownerManaged).length,1);
 assert.equal(e.fields.find(f=>f.ownerManaged).name,"owner");
 assert.deepEqual(compileOwnerScopes(ir).get("PrivateNote"),{field:"owner",column:"owner"});
 assert.equal(ir.operations.filter(o=>o.entity==="PrivateNote").length,4); // includes public health
});
test("adversarial IR mutations cannot evade owner scope",()=>{
 const mutations=[
  ir=>{ir.entities[0].fields.find(f=>f.ownerManaged).ownerManaged=false;ir.entities[0].fields.find(f=>f.name==="title").ownerManaged=true;},
  ir=>{ir.entities[0].fields.find(f=>f.ownerManaged).required=false;},
  ir=>{ir.entities[0].fields.find(f=>f.ownerManaged).nullable=true;},
  ir=>{ir.entities[0].fields.find(f=>f.ownerManaged).maxLength=20;},
  ir=>{ir.operations.find(o=>o.name==="getNote").capability="public";},
  ir=>{ir.operations.find(o=>o.name==="listNotes").behavior.kind="queryPage";},
  ir=>{ir.operations.push({...ir.operations.find(o=>o.name==="listNotes"),name:"rogue",behavior:{kind:"delete"}});},
  ir=>{ir.entities[0].fields.find(f=>f.name==="title").reference={target:"PrivateNote",onDelete:"restrict"};}
 ];
 for(const mutate of mutations){const copy=structuredClone(ir);mutate(copy);
  assert.throws(()=>compileOwnerScopes(copy),/Invalid S1a owner/);
 }
});
test("compilation refuses forgeable owner DTO and unsupported domain operations",()=>{
 const cases=[
  ['@minLength(1) @maxLength(90) title: string;\n  }\n  model NotePage',
    '@minLength(1) @maxLength(90) title: string;\n    owner: string;\n  }\n  model NotePage'],
  ['@ownerIdentity @minLength(1) @maxLength(128)','@ownerIdentity @minLength(1) @maxLength(20)'],
  ['@ownerIdentity @minLength(1) @maxLength(128)','@minLength(1) @maxLength(128)'],
  ['@ownerIdentity @minLength(1) @maxLength(128)','@ownerIdentity @minLength(1) @maxLength(128)\n    @ownerIdentity'],
  ['@behavior("listPage","PrivateNote")','@behavior("queryPage","PrivateNote")']
 ];
 for(const [from,to] of cases){
  const folder=mkdtempSync(join("examples/vnext",".owner-negative-"));
  try{
   cpSync(join(root,"tspconfig.yaml"),join(folder,"tspconfig.yaml"));
   cpSync(join(root,"contracts"),join(folder,"contracts"),{recursive:true});
   const edited=source.replace(from,to);assert.notEqual(edited,source);
   writeFileSync(join(folder,"contracts/main.tsp"),edited);
   const run=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",folder],{encoding:"utf8",timeout:90000});
   assert.notEqual(run.status,0,"Invalid owner metadata unexpectedly compiled");
  }finally{rmSync(folder,{recursive:true,force:true});}
 }
});
