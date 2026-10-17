import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {assertPatchTogether} from "../../packages/adapters/compound-patch.mjs";
import {uniqueTogetherSql} from "../../packages/adapters/composite-uniqueness.mjs";

const root="examples/vnext/compound-update-3";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const field=name=>({name,type:"string",required:true,nullable:false,unique:false});
const fields=["branch","period","department","region"];
function entity(names){return {name:"Batch",publicIdentity:"code",uniqueTogether:names,
  fields:[{...field("code"),unique:true},...names.map(field)]};}
function operation(names){return {name:"changeBusinessKey",method:"PATCH",
  statuses:[200,400,404,409],behavior:{kind:"patchTogether",input:names.join(",")}};}

test("B7 adapters support complete three- and four-column keys, reject partial or unsafe updates",()=>{
  for(const n of [3,4]){
    const names=fields.slice(0,n),e=entity(names),op=operation(names);
    assert.deepEqual(assertPatchTogether(e,op),names);
    assert.match(uniqueTogetherSql(e)[0],new RegExp("UNIQUE \\("+names.join(",")+"\\)"));
    for(const input of [names.slice(0,-1).join(","),[...names,"extra"].join(","),
      [...names].reverse().join(","),[names[0],names[0],...names.slice(2)].join(",")])
      assert.throws(()=>assertPatchTogether(e,{...op,behavior:{...op.behavior,input}}));
    assert.throws(()=>assertPatchTogether({...e,uniqueWhen:{stateField:"state"}},op));
    assert.throws(()=>assertPatchTogether({...e,fields:e.fields.map(f=>
      f.name===names[n-1]?{...f,reference:{target:"Branch"}}:f)},op));
    assert.throws(()=>assertPatchTogether(e,{...op,statuses:[200,400,404]}));
  }
  assert.throws(()=>assertPatchTogether(entity(["branch"]),operation(["branch"])));
  assert.throws(()=>assertPatchTogether(entity([...fields,"fifth"]),operation([...fields,"fifth"])));
});

function compile(project){return spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",project],
  {encoding:"utf8",timeout:90000});}
test("B7 independent three-field TypeSpec contract compiles successfully",()=>{
  const result=compile(root);
  assert.equal(result.status,0,(result.stdout??"")+(result.stderr??""));
});
function negative(label,modify){
  const dir=mkdtempSync(join("examples/vnext",".multi-compound-negative-"));
  try{
    cpSync(join(root,"contracts"),join(dir,"contracts"),{recursive:true});
    cpSync(join(root,"tspconfig.yaml"),join(dir,"tspconfig.yaml"));
    const modified=modify(source);
    assert.notEqual(modified,source,label);
    writeFileSync(join(dir,"contracts/main.tsp"),modified);
    const result=compile(dir);
    assert.notEqual(result.status,0,label);
    assert.match((result.stdout??"")+(result.stderr??""),/protocolia-invalid-patch-together/,label);
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test("B7 compiler fails closed on incomplete three-field DTO, reordered decorator and missing 409",()=>{
  negative("omitted member",s=>s.replace(
    '    @minLength(2) @maxLength(30) department: string;\n  }\n  model BatchPage',
    '  }\n  model BatchPage'));
  negative("reordered members",s=>s.replace(
    '@patchTogether("branch,period,department")','@patchTogether("department,branch,period")'));
  negative("missing 409",s=>s.replace(
    'Batch | BadRequest | NotFound | Conflict | Unauthorized | Forbidden;',
    'Batch | BadRequest | NotFound | Unauthorized | Forbidden;'));
});
