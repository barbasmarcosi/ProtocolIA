import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,cpSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {uniqueTogetherSql} from "../../packages/adapters/composite-uniqueness.mjs";

const root="examples/vnext/composite-uniqueness";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const field=(name,required=true)=>({name,type:"string",required,nullable:false,unique:false});
const entity={name:"Inspection",publicIdentity:"number",
  uniqueTogether:["equipmentCode","period"],
  fields:[{...field("number"),unique:true},field("equipmentCode"),field("period")]};
test("compound SQL uses a single atomic constraint across both key columns",()=>{
  assert.deepEqual(uniqueTogetherSql(entity),[
    "  CONSTRAINT uq_inspection_business UNIQUE (equipment_code,period)"
  ]);
  assert.deepEqual(uniqueTogetherSql({...entity,uniqueTogether:undefined}),[]);
});
test("adapter rejects unsafe IR, missing, nullable, repeated or surrogate key",()=>{
  for(const together of [["equipmentCode","unknown"],["equipmentCode","equipmentCode"],
    ["number","period"],["period"],["equipmentCode","period","third","fourth","fifth"]]){
    assert.throws(()=>uniqueTogetherSql({...entity,uniqueTogether:together}));
  }
  assert.throws(()=>uniqueTogetherSql({...entity,fields:[field("number"),field("equipmentCode",false),field("period")]}));
  assert.throws(()=>uniqueTogetherSql({...entity,uniqueTogether:["equipmentCode","bad;DROP"]}));
});
function negative(label,fn,code){
  const dir=mkdtempSync(join("examples/vnext",".composite-negative-"));
  try{
    cpSync(join(root,"contracts"),join(dir,"contracts"),{recursive:true});
    cpSync(join(root,"tspconfig.yaml"),join(dir,"tspconfig.yaml"));
    const modified=fn(source);
    assert.notEqual(modified,source,label);
    writeFileSync(join(dir,"contracts/main.tsp"),modified);
    const out=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",dir],{
      encoding:"utf8",timeout:90000
    });
    assert.notEqual(out.status,0,label+" must fail compilation");
    assert.match((out.stdout??"")+(out.stderr??""),code);
  }finally{rmSync(dir,{force:true,recursive:true});}
}
test("TypeSpec detects malformed business keys and create DTO omissions",()=>{
  negative("unknown field",s=>s.replace('equipmentCode,period','equipmentCode,missing'),
    /protocolia-invalid-unique-together/);
  negative("duplicate field",s=>s.replace('equipmentCode,period','equipmentCode,equipmentCode'),
    /protocolia-invalid-unique-together/);
  negative("nullable key",s=>s.replace('    period: string;','    period?: string;'),
    /protocolia-invalid-unique-together/);
  negative("DTO omission",s=>s.replace('    @minLength(7) @maxLength(7) period: string;\n    @minLength(1) @maxLength(160) notes: string;',
    '    @minLength(1) @maxLength(160) notes: string;'),
    /protocolia-unique-together-request-mismatch/);
});
