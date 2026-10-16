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

test("portable exact decimal comparisons support different scales, not JS Number",()=>{
  assert.equal(decimal("priceCeiling").greaterThanField,"unitPrice");
  assert.equal(decimal("priceCeiling").decimal.scale,4);
  assert.equal(decimal("quantityLimit").greaterThanField,"quantity");
  assert.equal(decimal("quantityLimit").decimal.scale,4);
  assert.equal(decimal("quantity").decimal.scale,6);
  for(const n of ["priceCeiling","quantityLimit"]){
    assert.equal(decimal(n).required,false);
    assert.equal(decimal(n).nullable,false);
  }
});
test("comparison rejects absent, mixed-type, nullable, optional and self source",()=>{
  rejectMutation("absent source",s=>s.replace('@greaterThanField("unitPrice")','@greaterThanField("missing")'),
    /protocolia-invalid-greater-than-field/);
  rejectMutation("mixed scalar",s=>s.replace('@greaterThanField("unitPrice")','@greaterThanField("reading")'),
    /protocolia-invalid-greater-than-field/);
  rejectMutation("nullable optional source",s=>s.replace('@greaterThanField("unitPrice")','@greaterThanField("cost")'),
    /protocolia-invalid-greater-than-field/);
  rejectMutation("optional source",s=>s.replace('unitPrice: decimal;','unitPrice?: decimal;'),
    /protocolia-invalid-greater-than-field/);
  rejectMutation("self source",s=>s.replace('@greaterThanField("unitPrice")','@greaterThanField("priceCeiling")'),
    /protocolia-invalid-greater-than-field/);
});
test("decimal compared HTTP DTOs cannot omit or change precision and scale",()=>{
  rejectMutation("missing DTO target",s=>{
    const needle='    priceCeiling?: decimal;',i=s.lastIndexOf(needle);
    return s.slice(0,i)+s.slice(i+needle.length);
  },/protocolia-greater-than-request-mismatch|protocolia-decimal-request-mismatch/);
  rejectMutation("changed DTO scale",s=>{
    const needle='@exactDecimal(16, 4, "0")',i=s.lastIndexOf(needle);
    return s.slice(0,i)+needle.replace('16, 4','16, 3')+s.slice(i+needle.length);
  },/protocolia-greater-than-request-mismatch|protocolia-decimal-request-mismatch/);
});
