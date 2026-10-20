import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {assertPatchTogether} from "../../packages/adapters/compound-patch.mjs";

const root="examples/vnext/compound-update";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const simple=(name)=>({name,type:"string",required:true,nullable:false,unique:false});
const entity={name:"Batch",publicIdentity:"code",uniqueTogether:["branch","period"],
  fields:[{...simple("code"),unique:true},simple("branch"),simple("period")]};
const op={name:"changeBusinessKey",method:"PATCH",
  statuses:[200,400,404,409],behavior:{kind:"patchTogether",input:"branch,period"}};

test("adapters accept only exactly the declared two-column atomic mutation",()=>{
  assert.deepEqual(assertPatchTogether(entity,op),["branch","period"]);
  for(const input of ["branch","branch,branch","branch,unknown","branch,period,description","period,branch"]){
    assert.throws(()=>assertPatchTogether(entity,{...op,behavior:{...op.behavior,input}}));
  }
  assert.throws(()=>assertPatchTogether({...entity,uniqueTogether:undefined},op));
  assert.throws(()=>assertPatchTogether({...entity,uniqueWhen:{stateField:"status"}},op));
  assert.throws(()=>assertPatchTogether({...entity,fields:[
    {...simple("code"),unique:true},{...simple("branch"),reference:{target:"Office"}},simple("period")
  ]},op));
  assert.throws(()=>assertPatchTogether(entity,{...op,statuses:[200,400,404]}));
});

function negative(label,edit,diagnostic){
  const dir=mkdtempSync(join("examples/vnext",".compound-update-negative-"));
  try{
    cpSync(join(root,"contracts"),join(dir,"contracts"),{recursive:true});
    cpSync(join(root,"tspconfig.yaml"),join(dir,"tspconfig.yaml"));
    const altered=edit(source);
    assert.notEqual(altered,source,label);
    writeFileSync(join(dir,"contracts/main.tsp"),altered);
    const r=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",dir],
      {encoding:"utf8",timeout:90000});
    assert.notEqual(r.status,0,label);
    assert.match((r.stdout??"")+(r.stderr??""),diagnostic,label);
  }finally{rmSync(dir,{force:true,recursive:true});}
}
test("compiler rejects unsafe two-column patches before output",()=>{
  negative("undeclared field",s=>s.replace('@patchTogether("branch,period")',
    '@patchTogether("branch,missing")'),/protocolia-invalid-patch-together/);
  negative("missing second field",s=>s.replace(
    '    @minLength(7) @maxLength(7) period: string;\n  }\n  model BatchPage',
    '  }\n  model BatchPage'),/protocolia-invalid-patch-together/);
  negative("missing 409",s=>s.replace(
    'Batch | BadRequest | NotFound | Conflict | Unauthorized | Forbidden;',
    'Batch | BadRequest | NotFound | Unauthorized | Forbidden;'),
    /protocolia-invalid-patch-together/);
  negative("wrong behavior",s=>s.replace(
    '@patch @behavior("patchTogether","Batch")',
    '@patch @behavior("get","Batch")'),/protocolia-orphan-patch-together|protocolia-/);
});
