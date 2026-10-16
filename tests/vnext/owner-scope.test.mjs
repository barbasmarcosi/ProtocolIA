import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {compileOwnerScopes} from "../../packages/adapters/owner-scope.mjs";
const root="examples/vnext/owner-scope";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const ir=JSON.parse(readFileSync(join(root,"tsp-output/@protocolia/compiler/ir.json"),"utf8"));
test("S1b owner scope binds the single editable field to a separate capability",()=>{
 const e=ir.entities.find(x=>x.name==="PrivateNote");
 assert.equal(e.fields.filter(f=>f.ownerManaged).length,1);
 assert.equal(e.fields.find(f=>f.ownerManaged).name,"owner");
 assert.deepEqual(compileOwnerScopes(ir).get("PrivateNote"),{field:"owner",column:"owner"});
 assert.equal(ir.operations.filter(o=>o.entity==="PrivateNote").length,5); // includes public health
 const patch=ir.operations.find(o=>o.name==="updateNoteTitle");
 assert.deepEqual([patch.behavior.field,patch.behavior.input,patch.capability],["title","title","notes.title.write"]);
 assert.notEqual(patch.capability,ir.operations.find(o=>o.name==="createNote").capability);
});
test("S1c private optional response is source-declared and independently authorized",()=>{
 const e=ir.entities.find(x=>x.name==="PrivateNote");
 assert.equal(e.fields.find(f=>f.name==="privateMemo").required,false);
 assert.equal(e.fields.find(f=>f.name==="privateMemo").readCapability,"notes.private.read");
 assert.equal(compileOwnerScopes(ir).get("PrivateNote").field,"owner");
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
  ir=>{ir.operations.find(o=>o.name==="updateNoteTitle").behavior.field="owner";},
  ir=>{ir.operations.find(o=>o.name==="updateNoteTitle").capability="notes.write";},
  ir=>{ir.operations.find(o=>o.name==="updateNoteTitle").capability="notes.read";},
  ir=>{ir.operations.find(o=>o.name==="updateNoteTitle").behavior.input="owner";},
  ir=>{ir.operations.push({...ir.operations.find(o=>o.name==="updateNoteTitle"),name:"secondPatch"});},
  ir=>{ir.operations.find(o=>o.name==="updateNoteTitle").behavior.kind="delete";},
  ir=>{ir.entities[0].fields.find(f=>f.name==="privateMemo").required=true;},
  ir=>{ir.entities[0].fields.find(f=>f.name==="privateMemo").readCapability="notes.read";},
  ir=>{ir.entities[0].fields.find(f=>f.name==="privateMemo").readCapability="notes.title.write";},
  ir=>{ir.entities[0].fields.find(f=>f.name==="privateMemo").readCapability="public";},
  ir=>{ir.entities[0].fields.find(f=>f.name==="privateMemo").reference={target:"PrivateNote"};},
  ir=>{ir.entities[0].fields.find(f=>f.name==="title").reference={target:"PrivateNote",onDelete:"restrict"};}
 ];
 for(const mutate of mutations){const copy=structuredClone(ir);mutate(copy);
  assert.throws(()=>compileOwnerScopes(copy),/Invalid S1[abc] (?:owner|field)/);
 }
});
test("compilation refuses forgeable owner DTO and unsupported domain operations",()=>{
 const cases=[
  ['@minLength(1) @maxLength(90) title: string;\n  }\n  model NoteTitleUpdate',
    '@minLength(1) @maxLength(90) title: string;\n    owner: string;\n  }\n  model NoteTitleUpdate'],
  ['@minLength(1) @maxLength(90) title: string;\n  }\n  model NotePage',
    '@minLength(1) @maxLength(90) title: string;\n    owner: string;\n  }\n  model NotePage'],
  ['@ownerIdentity @minLength(1) @maxLength(128)','@ownerIdentity @minLength(1) @maxLength(20)'],
  ['@readCapability("notes.private.read") @maxLength(180)','@readCapability("notes.read") @maxLength(180)'],
  ['@readCapability("notes.private.read") @maxLength(180)','@readCapability("public") @maxLength(180)'],
  ['privateMemo?: string;\n  }\n  model PrivateNoteInput','privateMemo: string;\n  }\n  model PrivateNoteInput'],
  ['@behavior("listPage","PrivateNote")','@behavior("queryPage","PrivateNote")'],
  ['@behavior("patchFields","PrivateNote","title","title")','@behavior("patchFields","PrivateNote","owner","owner")'],
  ['@capability("notes.title.write")','@capability("notes.write")'],
  ['@behavior("patchFields","PrivateNote","title","title")','@behavior("patchFields","PrivateNote","noteCode","noteCode")']
 ];
 for(const [from,to] of cases){
  const folder=mkdtempSync(join("examples/vnext",".owner-negative-"));
  try{
   cpSync(join(root,"tspconfig.yaml"),join(folder,"tspconfig.yaml"));
   cpSync(join(root,"contracts"),join(folder,"contracts"),{recursive:true});
   const edited=source.replace(from,to);assert.notEqual(edited,source);
   writeFileSync(join(folder,"contracts/main.tsp"),edited);
   const run=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",folder],{encoding:"utf8",timeout:90000});
   assert.notEqual(run.status,0,"Invalid owner mutation unexpectedly compiled: "+to);
  }finally{rmSync(folder,{recursive:true,force:true});}
 }
});
