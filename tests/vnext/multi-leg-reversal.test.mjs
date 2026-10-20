import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,cpSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {assertReverseBatch} from "../../packages/adapters/multi-leg-transfer.mjs";

const root="examples/vnext/multi-leg-reversal";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const fld=(name,type="string")=>({name,type,required:true,nullable:false,unique:false});
const bin={name:"Bin",publicIdentity:"sku",fields:[
  {...fld("sku"),unique:true},{...fld("available","int32"),min:0,max:100}]};
const legs=[{sourceField:"sourceSku1",targetField:"targetSku1",quantityField:"units1"},
  {sourceField:"sourceSku2",targetField:"targetSku2",quantityField:"units2"}];
const batch={name:"Batch",publicIdentity:"number",fields:[
  {...fld("number"),unique:true},
  ...legs.flatMap(x=>[
    {...fld(x.sourceField),reference:{target:"Bin",onDelete:"restrict"}},
    {...fld(x.targetField),reference:{target:"Bin",onDelete:"restrict"}},
    {...fld(x.quantityField,"int32"),min:1,max:80}
  ]),{...fld("status"),initial:"posted"}]};
const movement={stockEntity:"Bin",availableField:"available",legs};
const create={entity:"Batch",name:"createBatch",method:"POST",capability:"batches.write",
  statuses:[201,400,401,403,409],behavior:{kind:"create",moveBatch:movement}};
const reverse={entity:"Batch",name:"reverseBatchJournal",method:"POST",capability:"batches.write",
  statuses:[200,400,401,403,404,409],
  behavior:{kind:"transition",field:"status",from:"posted",to:"reversed",
    reverseBatch:movement,audit:["status"]}};
const ir={entities:[bin,batch],operations:[
  {entity:"Bin",name:"createBin",capability:"bins.write",behavior:{kind:"create"}},
  create,reverse
]};
test("B11 reversal is paired with exact immutable two-leg journal and independent parent authority",()=>{
 const plan=assertReverseBatch(ir,batch,reverse);
 assert.equal(plan.parentWriteCapability,"bins.write");
 assert.equal(plan.legs.length,2);
 const wrong=(changed)=>assert.throws(()=>assertReverseBatch(
   ir,changed.entity??batch,changed.op??reverse));
 // Cover intentionally malformed interface, not just emitted compiler data.
 wrong({op:{...reverse,statuses:[200,400,404,409]}});
 wrong({op:{...reverse,behavior:{...reverse.behavior,audit:[]}}});
 wrong({op:{...reverse,behavior:{...reverse.behavior,from:"reversed"}}});
 wrong({op:{...reverse,behavior:{...reverse.behavior,reverseBatch:{
   ...movement,legs:[legs[0],{...legs[1],targetField:"sourceSku1"}]}}}});
 wrong({entity:{...batch,fields:batch.fields.map(f=>
   f.name==="status"?{...f,initial:"reversed"}:f)}});
 assert.throws(()=>assertReverseBatch({...ir,operations:[...ir.operations,
   {entity:"Batch",name:"patch",behavior:{kind:"patchFields"}}]},batch,reverse));
 assert.throws(()=>assertReverseBatch({...ir,operations:[...ir.operations,reverse]},batch,reverse));
 assert.throws(()=>assertReverseBatch({...ir,operations:[
   {...ir.operations[0],capability:"public"},create,reverse]},batch,reverse));
});
function compile(path){return spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),
  ["compile",path],{encoding:"utf8",timeout:90000});}
test("B11 TypeSpec generates canonical matching reversal rule",()=>{
 const x=compile(root);assert.equal(x.status,0,(x.stdout??"")+(x.stderr??""));
 const ir=JSON.parse(readFileSync(join(root,"tsp-output","@protocolia","compiler","ir.json"),"utf8"));
 assert.deepEqual(ir.operations.find(x=>x.name==="reverseBatchJournal").behavior.reverseBatch,movement);
});
function negative(name,replace){
 const dir=mkdtempSync(join("examples/vnext",".reversal-negative-"));
 try{
   cpSync(join(root,"contracts"),join(dir,"contracts"),{recursive:true});
   cpSync(join(root,"tspconfig.yaml"),join(dir,"tspconfig.yaml"));
   const updated=replace(source);assert.notEqual(updated,source,name);
   writeFileSync(join(dir,"contracts/main.tsp"),updated);
   const out=compile(dir);assert.notEqual(out.status,0,name);
   assert.match((out.stdout??"")+(out.stderr??""),
     /protocolia-invalid-reverse-batch|protocolia-reverse-batch-http|protocolia-transition-http/,name);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test("B11 compiler rejects mismatched legs, removed audit, altered state and missing 409",()=>{
 negative("wrong second leg",s=>s.replace(
   '@reverseBatch("Bin","available","sourceSku1,targetSku1,units1;sourceSku2,targetSku2,units2")',
   '@reverseBatch("Bin","available","sourceSku1,targetSku1,units1;sourceSku2,targetSku2,units1")'));
 negative("missing audit",s=>s.replace('  @audit("status") @capability("batches.write")',
   '  @capability("batches.write")'));
 negative("wrong transition",s=>s.replace('@transition("posted","reversed")',
   '@transition("reversed","posted")'));
 negative("client supplies lifecycle state",s=>s.replace(
   '    @minLength(1) @maxLength(120) note:string;\n  }\n  model BinPage',
   '    @minLength(1) @maxLength(120) note:string;\n    status:string;\n  }\n  model BinPage'));
 negative("status 409 absent",s=>s.replace(
   'Batch | Missing | Conflict | Invalid | Unauthorized | Forbidden;',
   'Batch | Missing | Invalid | Unauthorized | Forbidden;'));
});
