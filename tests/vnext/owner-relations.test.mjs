import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,cpSync,mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {compileOwnerScopes} from "../../packages/adapters/owner-scope.mjs";
const root="examples/vnext/owner-relations";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const ir=JSON.parse(readFileSync(join(root,"tsp-output/@protocolia/compiler/ir.json"),"utf8"));
test("Owned child has one safely compiled owner-to-owner relation",()=>{
 const plans=compileOwnerScopes(ir);
 assert.deepEqual(plans.get("Folder"),{field:"owner",column:"owner"});
 assert.deepEqual(plans.get("FolderNote"),{field:"owner",column:"owner",relation:{
  field:"folderCode",parentTable:"folder",parentKey:"folder_code",
  parentOwnerColumn:"owner",parentReadCapability:"folders.read"
 }});
 const child=ir.entities.find(e=>e.name==="FolderNote");
 assert.equal(child.fields.filter(f=>f.reference).length,1);
 assert.equal(ir.operations.filter(o=>o.entity==="FolderNote"&&o.behavior.kind==="create").length,1);
});
test("Malicious IR ownership edges are fail-closed",()=>{
 const changes=[
  x=>{x.entities.find(e=>e.name==="Folder").fields.find(f=>f.ownerManaged).ownerManaged=false;},
  x=>{x.entities.find(e=>e.name==="FolderNote").fields.find(f=>f.ownerManaged).ownerManaged=false;},
  x=>{x.entities.find(e=>e.name==="FolderNote").fields.find(f=>f.name==="folderCode").reference.onDelete="cascade";},
  x=>{x.entities.find(e=>e.name==="FolderNote").fields.find(f=>f.name==="folderCode").nullable=true;},
  x=>{x.entities.find(e=>e.name==="FolderNote").fields.find(f=>f.name==="folderCode").required=false;},
  x=>{x.entities.find(e=>e.name==="FolderNote").fields.find(f=>f.name==="folderCode").reference.target="FolderNote";},
  x=>{x.operations.find(o=>o.name==="getFolder").capability="public";},
  x=>{x.entities.find(e=>e.name==="Folder").fields.find(f=>f.name==="folderCode").reference={target:"FolderNote",onDelete:"restrict"};},
  x=>{x.entities.find(e=>e.name==="FolderNote").fields.find(f=>f.name==="title").reference={target:"Folder",onDelete:"restrict"};},
  x=>{x.operations.push({...x.operations.find(o=>o.name==="getFolderNote"),name:"unsafeQuery",behavior:{kind:"queryPage"}});}
 ];
 for(const edit of changes){const x=structuredClone(ir);edit(x);
  assert.throws(()=>compileOwnerScopes(x),/Invalid S1|Invalid S1d|Invalid S1a/);
 }
});
test("TypeSpec compiler rejects unsafe private FK contracts",()=>{
 const negatives=[
  ['@reference("Folder","restrict") @minLength(1) @maxLength(40)',
   '@reference("Folder","cascade") @minLength(1) @maxLength(40)'],
  ['@reference("Folder","restrict") @minLength(1) @maxLength(40)',
   '@reference("FolderNote","restrict") @minLength(1) @maxLength(40)'],
  ['@reference("Folder","restrict") @minLength(1) @maxLength(40)',
   '@reference("Folder","restrict") @minLength(1) @maxLength(40) @unique'],
  ['@ownerIdentity @minLength(1) @maxLength(128)\n    owner: string;\n    @reference("Folder"',
   '@minLength(1) @maxLength(128)\n    owner: string;\n    @reference("Folder"'],
  ['@reference("Folder","restrict") @minLength(1) @maxLength(40)',
   '@reference("Folder","restrict") @minLength(1) @maxLength(40) @initial("unknown")']
 ];
 for(const [before,after] of negatives){
  const folder=mkdtempSync(join("examples/vnext",".owner-relation-invalid-"));
  try{
   cpSync(join(root,"tspconfig.yaml"),join(folder,"tspconfig.yaml"));
   cpSync(join(root,"contracts"),join(folder,"contracts"),{recursive:true});
   const edited=source.replace(before,after);assert.notEqual(edited,source);
   writeFileSync(join(folder,"contracts/main.tsp"),edited);
   const out=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",folder],
     {encoding:"utf8",timeout:90000});
   assert.notEqual(out.status,0,"Unsafe relation compiled: "+after);
  }finally{rmSync(folder,{recursive:true,force:true});}
 }
});
