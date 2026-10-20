import test from "node:test";
import assert from "node:assert/strict";
import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {assertMoveUnits} from "../../packages/adapters/stock-transfer.mjs";

const root="examples/vnext/stock-transfer";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const f=(name,type="string")=>({name,type,required:true,nullable:false,unique:false});
const stock={name:"Bin",publicIdentity:"sku",fields:[
  {...f("sku"),unique:true},{...f("available","int32"),min:0,max:100}]};
const movement={name:"Movement",publicIdentity:"number",fields:[
  {...f("number"),unique:true},
  {...f("sourceSku"),reference:{target:"Bin",onDelete:"restrict"}},
  {...f("targetSku"),reference:{target:"Bin",onDelete:"restrict"}},
  {...f("units","int32"),min:1,max:60},
  f("note")]};
const moved={stockEntity:"Bin",availableField:"available",sourceField:"sourceSku",
  targetField:"targetSku",quantityField:"units"};
const op={name:"createMovement",entity:"Movement",method:"POST",
  capability:"movements.write",statuses:[201,400,401,403,409],
  behavior:{kind:"create",moveUnits:moved}};
const ir={entities:[stock,movement],operations:[
  {name:"createBin",entity:"Bin",capability:"bins.write",behavior:{kind:"create"}},op]};
test("B8 adapters accept two required distinct FKs, positive bounded units and separate write authority",()=>{
  const plan=assertMoveUnits(ir,movement,op);
  assert.equal(plan.parentWriteCapability,"bins.write");
  assert.equal(plan.available.max,100);
  const fail=(patch)=>assert.throws(()=>assertMoveUnits(patch.ir??ir,patch.entity??movement,
    patch.op??op));
  fail({op:{...op,statuses:[201,400,403]}});
  fail({op:{...op,behavior:{...op.behavior,moveUnits:{...moved,targetField:"sourceSku"}}}});
  fail({op:{...op,behavior:{...op.behavior,moveUnits:{...moved,quantityField:"note"}}}});
  fail({entity:{...movement,fields:movement.fields.map(x=>x.name==="targetSku"?{...x,reference:undefined}:x)}});
  fail({ir:{...ir,entities:[{...stock,fields:[...stock.fields,{...f("owner"),ownerManaged:true}]},movement]}});
  fail({ir:{...ir,operations:[{...ir.operations[0],capability:"public"},op]}});
  fail({ir:{...ir,entities:[{...stock,fields:stock.fields.map(x=>x.name==="available"?{...x,min:-1}:x)},movement]}});
  fail({op:{...op,behavior:{...op.behavior,reserve:{}}}});
});
function compile(project){return spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),
  ["compile",project],{encoding:"utf8",timeout:90000});}
test("B8 independent transfer TypeSpec emits contract and IR",()=>{
  const result=compile(root);
  assert.equal(result.status,0,(result.stdout??"")+(result.stderr??""));
  const ir=JSON.parse(readFileSync(join(root,"tsp-output","@protocolia","compiler","ir.json"),"utf8"));
  const rule=ir.operations.find(x=>x.name==="createMovement")?.behavior.moveUnits;
  assert.deepEqual(rule,moved);
});
function negative(name,transform){
  const path=mkdtempSync(join("examples/vnext",".stock-transfer-negative-"));
  try{
    cpSync(join(root,"contracts"),join(path,"contracts"),{recursive:true});
    cpSync(join(root,"tspconfig.yaml"),join(path,"tspconfig.yaml"));
    const changed=transform(source);assert.notEqual(changed,source,name);
    writeFileSync(join(path,"contracts/main.tsp"),changed);
    const out=compile(path);
    assert.notEqual(out.status,0,name);
    assert.match((out.stdout??"")+(out.stderr??""),/protocolia-invalid-move-units|protocolia-move-units-http/,name);
  }finally{rmSync(path,{force:true,recursive:true});}
}
test("B8 rejects unsafe TypeSpec before generating source",()=>{
  negative("same FK",s=>s.replace(
    '@moveUnits("Bin","available","sourceSku","targetSku","units")',
    '@moveUnits("Bin","available","sourceSku","sourceSku","units")'));
  negative("no valid target FK",s=>s.replace(
    '@moveUnits("Bin","available","sourceSku","targetSku","units")',
    '@moveUnits("Bin","available","sourceSku","note","units")'));
  negative("zero quantity allowed",s=>s.replace(
    '@minValue(1) @maxValue(60) units: int32;\n    @minLength(1) @maxLength(150) note: string;\n  }\n  model BinRequest',
    '@minValue(0) @maxValue(60) units: int32;\n    @minLength(1) @maxLength(150) note: string;\n  }\n  model BinRequest'));
  negative("missing 409",s=>s.replace(
    'result:Movement;} | Conflict | BadRequest | Unauthorized | Forbidden;',
    'result:Movement;} | BadRequest | Unauthorized | Forbidden;'));
});
