import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,cpSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {assertReverseUnits} from "../../packages/adapters/stock-transfer.mjs";

const root="examples/vnext/stock-reversal";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const field=(name,type="string")=>({name,type,required:true,nullable:false,unique:false});
const bin={name:"Bin",publicIdentity:"sku",fields:[{...field("sku"),unique:true},
  {...field("available","int32"),min:0,max:100}]};
const movement={name:"Movement",publicIdentity:"number",fields:[
  {...field("number"),unique:true},
  {...field("sourceSku"),reference:{target:"Bin",onDelete:"restrict"}},
  {...field("targetSku"),reference:{target:"Bin",onDelete:"restrict"}},
  {...field("units","int32"),min:1,max:60},field("note"),
  {...field("status"),initial:"posted"}]};
const rule={stockEntity:"Bin",availableField:"available",sourceField:"sourceSku",
  targetField:"targetSku",quantityField:"units"};
const create={entity:"Movement",name:"createMovement",method:"POST",capability:"movements.write",
  statuses:[201,400,401,403,409],behavior:{kind:"create",moveUnits:rule}};
const reverse={entity:"Movement",name:"reverseMovement",method:"POST",capability:"movements.write",
  statuses:[200,400,401,403,404,409],
  behavior:{kind:"transition",field:"status",from:"posted",to:"reversed",
    reverseUnits:rule,audit:["status"]}};
const ir={entities:[bin,movement],operations:[
  {entity:"Bin",name:"createBin",capability:"bins.write",behavior:{kind:"create"}},
  create,reverse]};
test("B9 adapters enforce one paired creator, state CAS, parent write and immutable references",()=>{
  const plan=assertReverseUnits(ir,movement,reverse);
  assert.equal(plan.parentWriteCapability,"bins.write");
  const invalid=(x)=>assert.throws(()=>assertReverseUnits(x.ir??ir,x.entity??movement,x.reverse??reverse));
  invalid({reverse:{...reverse,behavior:{...reverse.behavior,audit:[]}}});
  invalid({reverse:{...reverse,behavior:{...reverse.behavior,from:"reversed"}}});
  invalid({reverse:{...reverse,behavior:{...reverse.behavior,reverseUnits:{...rule,targetField:"sourceSku"}}}});
  invalid({entity:{...movement,fields:movement.fields.map(f=>f.name==="status"?{...f,initial:"reversed"}:f)}});
  invalid({ir:{...ir,operations:[...ir.operations,
    {entity:"Movement",behavior:{kind:"delete"}}]}});
  invalid({ir:{...ir,operations:[...ir.operations,reverse]}});
  invalid({ir:{...ir,operations:[{...ir.operations[0],capability:"public"},create,reverse]}});
  invalid({ir:{...ir,operations:[ir.operations[0],{...create,behavior:{kind:"create",moveUnits:{...rule,targetField:"note"}}},reverse]}});
});
function compile(project){return spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",project],
  {encoding:"utf8",timeout:90000});}
test("B9 TypeSpec builds a matched reversible movement in IR",()=>{
  const x=compile(root);assert.equal(x.status,0,(x.stdout??"")+(x.stderr??""));
  const ir=JSON.parse(readFileSync(join(root,"tsp-output","@protocolia","compiler","ir.json"),"utf8"));
  assert.deepEqual(ir.operations.find(x=>x.name==="reverseMovement").behavior.reverseUnits,rule);
});
function negative(name,fn){
  const tmp=mkdtempSync(join("examples/vnext",".reverse-units-negative-"));
  try{
    cpSync(join(root,"contracts"),join(tmp,"contracts"),{recursive:true});
    cpSync(join(root,"tspconfig.yaml"),join(tmp,"tspconfig.yaml"));
    const modified=fn(source);assert.notEqual(modified,source,name);
    writeFileSync(join(tmp,"contracts/main.tsp"),modified);
    const out=compile(tmp);assert.notEqual(out.status,0,name);
    assert.match((out.stdout??"")+(out.stderr??""),/protocolia-invalid-reverse-units|protocolia-reverse-units-http/,name);
  }finally{rmSync(tmp,{recursive:true,force:true});}
}
test("B9 compiler rejects lifecycle bypasses and unsupported cancellation",()=>{
  negative("missing creator",s=>s.replace(
    '@moveUnits("Bin","available","sourceSku","targetSku","units")',
    '@moveUnits("Bin","available","sourceSku","sourceSku","units")'));
  negative("reverse wrong stock binding",s=>s.replace(
    '@reverseUnits("Bin","available","sourceSku","targetSku","units")',
    '@reverseUnits("Bin","available","sourceSku","targetSku","note")'));
  negative("no audit",s=>s.replace('  @audit("status")\n',''));
  negative("wrong source state",s=>s.replace('@transition("posted","reversed")','@transition("reversed","posted")'));
  negative("client-supplied status",s=>s.replace(
    '    @minLength(1) @maxLength(150) note: string;\n  }\n  model BinPage',
    '    @minLength(1) @maxLength(150) note: string;\n    status: string;\n  }\n  model BinPage'));
  negative("reversal without conflict",s=>s.replace(
    'Movement | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;',
    'Movement | NotFound | BadRequest | Unauthorized | Forbidden;'));
});
