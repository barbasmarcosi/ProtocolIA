import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,cpSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {assertMoveBatch} from "../../packages/adapters/multi-leg-transfer.mjs";
const root="examples/vnext/multi-leg-settlement";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const f=(name,type="string")=>({name,type,required:true,nullable:false,unique:false});
const stock={name:"Bin",publicIdentity:"sku",fields:[{...f("sku"),unique:true},
  {...f("available","int32"),min:0,max:100}]};
const legs=[
  {sourceField:"sourceSku1",targetField:"targetSku1",quantityField:"units1"},
  {sourceField:"sourceSku2",targetField:"targetSku2",quantityField:"units2"},
  {sourceField:"sourceSku3",targetField:"targetSku3",quantityField:"units3"},
  {sourceField:"sourceSku4",targetField:"targetSku4",quantityField:"units4"}
];
function entity(n){
 return {name:"Batch",publicIdentity:"number",fields:[
   {...f("number"),unique:true},
   ...legs.slice(0,n).flatMap(x=>[
     {...f(x.sourceField),reference:{target:"Bin",onDelete:"restrict"}},
     {...f(x.targetField),reference:{target:"Bin",onDelete:"restrict"}},
     {...f(x.quantityField,"int32"),min:1,max:80}
   ])]};
}
function ir(n){
 const e=entity(n);
 return {entities:[stock,e],operations:[
   {entity:"Bin",name:"createBin",capability:"bins.write",behavior:{kind:"create"}},
   {entity:"Batch",name:"createBatch",method:"POST",statuses:[201,400,401,403,409],
     capability:"batches.write",behavior:{kind:"create",moveBatch:{
       stockEntity:"Bin",availableField:"available",legs:legs.slice(0,n)}}}
 ]};
}
test("B10 strict adapters accept two to four independent legs with shared parent identity",()=>{
 for(const n of [2,3,4]){
   const d=ir(n),plan=assertMoveBatch(d,d.entities[1],d.operations[1]);
   assert.equal(plan.legs.length,n);
   assert.equal(plan.parentWriteCapability,"bins.write");
   assert.equal(plan.available.max,100);
 }
 for(const n of [1,5]){
   const d=ir(n),invalid=n===5?[...legs,{sourceField:"s5",targetField:"t5",quantityField:"q5"}]:legs.slice(0,n);
   assert.throws(()=>assertMoveBatch(d,d.entities[1],
     {...d.operations[1],behavior:{kind:"create",moveBatch:{
       stockEntity:"Bin",availableField:"available",legs:invalid}}}));
 }
 const d=ir(2),e=d.entities[1],op=d.operations[1];
 const bad=(metadata,changed=d)=>assert.throws(()=>assertMoveBatch(changed,changed.entities[1],
   {...changed.operations[1],...metadata}));
 bad({statuses:[201,400,401,403]});
 bad({behavior:{...op.behavior,moveBatch:{...op.behavior.moveBatch,
   legs:[legs[0],{...legs[1],sourceField:"sourceSku1"}]}}});
 bad({behavior:{...op.behavior,moveBatch:{...op.behavior.moveBatch,
   legs:[legs[0],{...legs[1],quantityField:"targetSku2"}]}}});
 bad({behavior:{...op.behavior,moveUnits:{}}});
 bad({}, {...d,entities:[{...stock,fields:stock.fields.map(x=>
   x.name==="available"?{...x,min:-1}:x)},e]});
 bad({}, {...d,operations:[{...d.operations[0],capability:"public"},op]});
 bad({}, {...d,entities:[stock,{...e,fields:e.fields.map(x=>
   x.name==="targetSku2"?{...x,reference:null}:x)}]});
 bad({}, {...d,operations:[...d.operations,{entity:"Batch",behavior:{kind:"patchFields"}}]});
});
function compile(project){return spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),
  ["compile",project],{encoding:"utf8",timeout:90000});}
test("B10 independent TypeSpec compiles to canonical 2-leg behavior and OpenAPI",()=>{
 const p=compile(root);assert.equal(p.status,0,(p.stdout??"")+(p.stderr??""));
 const data=JSON.parse(readFileSync(join(root,"tsp-output","@protocolia","compiler","ir.json"),"utf8"));
 assert.deepEqual(data.operations.find(x=>x.name==="createBatch").behavior.moveBatch,{
   stockEntity:"Bin",availableField:"available",legs:legs.slice(0,2)});
});
function negative(name,fn){
 const temp=mkdtempSync(join("examples/vnext",".multi-batch-negative-"));
 try{
   cpSync(join(root,"contracts"),join(temp,"contracts"),{recursive:true});
   cpSync(join(root,"tspconfig.yaml"),join(temp,"tspconfig.yaml"));
   const changed=fn(source);assert.notEqual(changed,source,name);
   writeFileSync(join(temp,"contracts/main.tsp"),changed);
   const result=compile(temp);
   assert.notEqual(result.status,0,name);
   assert.match((result.stdout??"")+(result.stderr??""),
     /protocolia-invalid-move-batch|protocolia-move-batch-http/,name);
 }finally{rmSync(temp,{recursive:true,force:true});}
}
test("B10 compiler fails closed on duplicate leg field, absent FK, zero quantity and missing 409",()=>{
 const dec='@moveBatch("Bin","available","sourceSku1,targetSku1,units1;sourceSku2,targetSku2,units2")';
 negative("duplicate leg",s=>s.replace(dec,
   '@moveBatch("Bin","available","sourceSku1,targetSku1,units1;sourceSku1,targetSku2,units2")'));
 negative("broken reference",s=>s.replace(dec,
   '@moveBatch("Bin","available","sourceSku1,targetSku1,units1;sourceSku2,note,units2")'));
 negative("zero accepted",s=>s.replace(
   '@minValue(1) @maxValue(80) units2:int32;\n    @minLength(1) @maxLength(120) note:string;\n  }\n  model BinRequest',
   '@minValue(0) @maxValue(80) units2:int32;\n    @minLength(1) @maxLength(120) note:string;\n  }\n  model BinRequest'));
 negative("missing conflict",s=>s.replace(
   'result:Batch;} | Invalid | Conflict | Unauthorized | Forbidden;',
   'result:Batch;} | Invalid | Unauthorized | Forbidden;'));
});
