import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,cpSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {uniqueWhenSql} from "../../packages/adapters/conditional-uniqueness.mjs";
const root="examples/vnext/active-work-orders";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const field=(name,overrides={})=>({name,type:"string",required:true,nullable:false,unique:false,...overrides});
const entity={name:"WorkOrder",publicIdentity:"code",
  fields:[field("code",{unique:true}),field("siteCode"),field("period"),
    field("status",{initial:"draft"})],
  uniqueWhen:{fields:["siteCode","period"],stateField:"status",activeState:"approved"}};
const op=(name,from,to)=>({name,entity:"WorkOrder",behavior:{kind:"transition",field:"status",from,to}});
const operations=[op("approve","draft","approved"),op("close","approved","closed")];
test("active-only business rule emits a safe PostgreSQL partial unique index",()=>{
  assert.deepEqual(uniqueWhenSql(entity,operations),[
    "CREATE UNIQUE INDEX uq_work_order_active ON work_order (site_code,period) WHERE status = 'approved';"
  ]);
  assert.deepEqual(uniqueWhenSql({...entity,uniqueWhen:undefined},operations),[]);
});
test("partial uniqueness adapter rejects unsafe externally supplied IR and lifecycle",()=>{
  const bad=rule=>uniqueWhenSql({...entity,uniqueWhen:{...entity.uniqueWhen,...rule}},operations);
  for(const fields of [["siteCode","missing"],["siteCode","siteCode"],
    ["code","period"],["siteCode"],["siteCode","period","status"]]){
    assert.throws(()=>bad({fields}));
  }
  assert.throws(()=>bad({activeState:"a' OR TRUE--"}));
  assert.throws(()=>bad({stateField:"missing"}));
  assert.throws(()=>uniqueWhenSql({...entity,
    fields:entity.fields.map(f=>f.name==="period"?{...f,required:false}:f)},operations));
  assert.throws(()=>uniqueWhenSql({...entity,uniqueTogether:["siteCode","period"]},operations));
  assert.throws(()=>uniqueWhenSql(entity,[operations[0]]));
  assert.throws(()=>uniqueWhenSql(entity,[...operations,
    {entity:"WorkOrder",behavior:{kind:"patchFields",field:"period"}}]));
});
function negative(label,update,diagnostic){
  const tmp=mkdtempSync(join("examples/vnext",".b5-negative-"));
  try{
    cpSync(join(root,"contracts"),join(tmp,"contracts"),{recursive:true});
    cpSync(join(root,"tspconfig.yaml"),join(tmp,"tspconfig.yaml"));
    const modified=update(source);
    assert.notEqual(modified,source,label);
    writeFileSync(join(tmp,"contracts/main.tsp"),modified);
    const r=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",tmp],
      {encoding:"utf8",timeout:90000});
    assert.notEqual(r.status,0,label+" must fail TypeSpec");
    assert.match((r.stderr??"")+(r.stdout??""),diagnostic,label);
  }finally{rmSync(tmp,{force:true,recursive:true});}
}
test("TypeSpec rejects invalid active state, nullable keys and inconsistent lifecycle",()=>{
  negative("unknown business field",s=>s.replace("siteCode,period","siteCode,unknown"),
    /protocolia-invalid-unique-when/);
  negative("nullable business key",s=>s.replace("    period: string;","    period?: string;"),
    /protocolia-invalid-unique-when/);
  negative("unsafe state literal",s=>s.replace('"status","approved"','"status","approved\' OR TRUE"'),
    /protocolia-invalid-unique-when/);
  negative("missing exit transition",s=>s.replace('@transition("approved", "closed")',
    '@transition("draft", "closed")'),/protocolia-unique-when-lifecycle/);
  negative("duplicate business fields",s=>s.replace("siteCode,period","siteCode,siteCode"),
    /protocolia-invalid-unique-when/);
});
