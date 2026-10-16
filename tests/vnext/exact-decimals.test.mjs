import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
const root="examples/vnext/exact-decimals";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const ir=JSON.parse(readFileSync(join(root,"tsp-output/@protocolia/compiler/ir.json"),"utf8"));
const entity=ir.entities.find(e=>e.name==="Gauge");
const decimal=(name)=>entity.fields.find(f=>f.name===name);
test("exact decimal metadata is source-derived, nullable and never a number",()=>{
  assert.equal(decimal("unitPrice").type,"decimal");
  assert.deepEqual(decimal("unitPrice").decimal,
    {precision:24,scale:4,min:"0",max:"99999999999999999999.9999"});
  assert.equal(decimal("unitPrice").required,true);
  assert.equal(decimal("cost").nullable,true);
  assert.equal(decimal("cost").required,false);
  assert.equal(decimal("percentage").decimal.max,"100");
  assert.deepEqual(decimal("quantity").decimal,
    {precision:16,scale:6,min:"0.000001",max:"9999999999.999999"});
});
test("TypeSpec OpenAPI declares lossless string representation",()=>{
  const document=JSON.parse(readFileSync(join(root,"tsp-output/@typespec/openapi3/openapi.json"),"utf8"));
  const dto=document.components.schemas.GaugeRequest;
  assert.ok(dto,"HTTP request contract must exist");
  const props=dto.properties;
  for(const name of ["unitPrice","quantity","percentage"]){
    assert.equal(props[name].type,"string","Not a JSON number: "+name);
  }
});
function rejectMutation(label,mutate,expected){
  const scratch=mkdtempSync(join("examples","vnext",".decimal-negative-"));
  try{
    cpSync(join(root,"tspconfig.yaml"),join(scratch,"tspconfig.yaml"));
    cpSync(join(root,"contracts"),join(scratch,"contracts"),{recursive:true});
    const changed=mutate(source);
    assert.notEqual(changed,source,label);
    writeFileSync(join(scratch,"contracts/main.tsp"),changed);
    const run=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",scratch],{
      encoding:"utf8",timeout:90000});
    assert.notEqual(run.status,0,"Invalid decimal contract accepted: "+label);
    assert.match((run.stderr??"")+(run.stdout??""),expected,label);
  }finally{rmSync(scratch,{recursive:true,force:true});}
}
test("missing wire encoding and unsafe exact metadata fail before generation",()=>{
  rejectMutation("missing encode",s=>s.replace('@encode(string)\n    @exactDecimal(24, 4','@exactDecimal(24, 4'),
    /protocolia-invalid-exact-decimal|encode/i);
  rejectMutation("scale beyond precision",s=>s.replace('@exactDecimal(24, 4','@exactDecimal(24, 25'),
    /protocolia-invalid-exact-decimal/i);
  rejectMutation("fractional bound exceeds scale",s=>s.replace('"0", "99999999999999999999.9999"','"0.00001", "99999999999999999999.9999"'),
    /protocolia-invalid-exact-decimal/i);
  rejectMutation("inverted bounds",s=>s.replace('"0", "100"','"101", "100"'),
    /protocolia-invalid-exact-decimal/i);
});
test("CREATE DTO cannot weaken a decimal to free text or change precision",()=>{
  rejectMutation("request weakens scalar",s=>{
    const where=s.lastIndexOf("unitPrice: decimal;");
    return s.slice(0,where)+"unitPrice: string;"+s.slice(where+"unitPrice: decimal;".length);
  },/protocolia-decimal-request-mismatch|encode/i);
  rejectMutation("request differs in scale",s=>{
    const needle='@exactDecimal(24, 4, "0", "99999999999999999999.9999")';
    const where=s.lastIndexOf(needle);
    return s.slice(0,where)+needle.replace("24, 4","24, 3")+s.slice(where+needle.length);
  },/protocolia-decimal-request-mismatch|protocolia-invalid-exact-decimal/i);
});
