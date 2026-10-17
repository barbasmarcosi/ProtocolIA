import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,cpSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {assertCreateDetails} from "../../packages/adapters/create-details.mjs";
const root="examples/vnext/dynamic-order-details";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
function compile(where){return spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),
 ["compile",where],{encoding:"utf8",timeout:90000});}
test("B12 TypeSpec compiles typed relational collection into canonical IR",()=>{
 const c=compile(root);assert.equal(c.status,0,(c.stdout??"")+(c.stderr??""));
 const ir=JSON.parse(readFileSync(join(root,"tsp-output","@protocolia","compiler","ir.json"),"utf8"));
 const op=ir.operations.find(x=>x.name==="createOrder");
 assert.deepEqual(op.behavior.createDetails,{
   childEntity:"OrderLine",parentField:"orderCode",rowsField:"lines",maxRows:20
 });
 const plan=assertCreateDetails(ir,ir.entities.find(x=>x.name==="Order"),op);
 assert.equal(plan.fields.length,3);
 assert.equal(plan.childWriteCapability,"lines.write");
 const throws=ir.operations.find(x=>x.name==="createOrder");
 assert.throws(()=>assertCreateDetails({...ir,operations:[
   ...ir.operations,{...throws,name:"another",path:"/api/extra"}
 ]},ir.entities.find(x=>x.name==="Order"),throws));
 assert.throws(()=>assertCreateDetails(ir,ir.entities.find(x=>x.name==="Order"),{
   ...throws,behavior:{...throws.behavior,createDetails:{...throws.behavior.createDetails,parentField:"lineCode"}}
 }));
});
function negative(name,change){
 const tmp=mkdtempSync(join("examples/vnext",".details-negative-"));
 try{
   cpSync(join(root,"contracts"),join(tmp,"contracts"),{recursive:true});
   cpSync(join(root,"tspconfig.yaml"),join(tmp,"tspconfig.yaml"));
   const result=change(source);assert.notEqual(result,source,name);
   writeFileSync(join(tmp,"contracts/main.tsp"),result);
   const run=compile(tmp);
   assert.notEqual(run.status,0,name);
   assert.match((run.stdout??"")+(run.stderr??""),
     /protocolia-invalid-create-details/,name);
 }finally{rmSync(tmp,{recursive:true,force:true});}
}
test("B12 fails closed for unbounded, missing FK, wrong row DTO, or weakened amounts",()=>{
 negative("no maximum",s=>s.replace('@minItems(1) @maxItems(20) lines:',
   '@minItems(1) lines:'));
 negative("no minimum",s=>s.replace('@minItems(1) @maxItems(20) lines:',
   '@maxItems(20) lines:'));
 negative("no FK",s=>s.replace('@reference("Order","restrict") @minLength(1) @maxLength(40) orderCode:string;',
   '@minLength(1) @maxLength(40) orderCode:string;'));
 negative("parent leaked",s=>s.replace(
   '  model OrderLineInput {\n',
   '  model OrderLineInput {\n    @minLength(1) @maxLength(40) orderCode:string;\n'));
 negative("wrong child quantity",s=>s.replace(
   '    @minValue(1) @maxValue(100) units:int32;\n  }\n  model OrderRequest',
   '    @minValue(0) @maxValue(100) units:int32;\n  }\n  model OrderRequest'));
});
