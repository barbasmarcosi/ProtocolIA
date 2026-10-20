import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
const root="examples/vnext/finite-choices";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const ir=JSON.parse(readFileSync(join(root,"tsp-output/@protocolia/compiler/ir.json"),"utf8"));
test("native TypeSpec enum survives canonical IR with stable values and human labels",()=>{
  const field=ir.entities.find(e=>e.name==="Gauge").fields.find(f=>f.name==="quality");
  assert.equal(field.type,"string");assert.equal(field.required,false);
  assert.deepEqual(field.choices,[
    {value:"ready",label:"Ready"},
    {value:"needs_service",label:"Needs Service"},
    {value:"retired",label:"Retired"}
  ]);
  assert.match(source,/quality\?: GaugeQuality/);
});
test("numeric, unsafe and excessively broad enum declarations fail before generation",()=>{
  const mutations=[
    ['Ready: "ready"', "Ready: 3"],
    ['NeedsService: "needs_service"', 'NeedsService: "not allowed"'],
    ['Retired: "retired"', 'Retired: "ready"']
  ];
  for(const [oldCode,replacement] of mutations){
    const scratch=mkdtempSync(join("examples","vnext",".enum-negative-"));
    try{
      cpSync(join(root,"tspconfig.yaml"),join(scratch,"tspconfig.yaml"));
      cpSync(join(root,"contracts"),join(scratch,"contracts"),{recursive:true});
      const mutated=source.replace(oldCode,replacement);
      assert.notEqual(mutated,source);
      writeFileSync(join(scratch,"contracts/main.tsp"),mutated);
      const run=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",scratch],{
        encoding:"utf8",timeout:90000
      });
      assert.notEqual(run.status,0,"Unsupported enum accepted: "+replacement);
      assert.match((run.stdout??"")+(run.stderr??""),/protocolia-unsupported-field|protocolia-invalid-enum-field|enum/i);
    }finally{rmSync(scratch,{recursive:true,force:true});}
  }
});

test("the compiler refuses a DTO that silently weakens its domain enum",()=>{
  const scratch=mkdtempSync(join("examples","vnext",".enum-dto-negative-"));
  try{
    cpSync(join(root,"tspconfig.yaml"),join(scratch,"tspconfig.yaml"));
    cpSync(join(root,"contracts"),join(scratch,"contracts"),{recursive:true});
    const needle="quality?: GaugeQuality;";
    const last=source.lastIndexOf(needle);
    assert.ok(last>source.indexOf(needle));
    const mutated=source.slice(0,last)+"quality?: string;"+source.slice(last+needle.length);
    writeFileSync(join(scratch,"contracts/main.tsp"),mutated);
    const run=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",scratch],{
      encoding:"utf8",timeout:90000
    });
    assert.notEqual(run.status,0,"Unconstrained request DTO must not compile");
    assert.match((run.stdout??"")+(run.stderr??""),/protocolia-enum-request-mismatch/i);
  }finally{rmSync(scratch,{recursive:true,force:true});}
});

test("requiredWhen survives TypeSpec into canonical domain IR",()=>{
  const entity=ir.entities.find(e=>e.name==="Gauge");
  const target=entity.fields.find(f=>f.name==="maintenanceReason");
  const trigger=entity.fields.find(f=>f.name==="quality");
  assert.deepEqual(target.requiredWhen,{field:"quality",equals:"needs_service"});
  assert.deepEqual(target.forbidWhen,{field:"quality",equals:"ready"});
  assert.equal(target.type,"string");assert.equal(target.required,false);
  assert.equal(target.nullable,false);
  assert.ok(trigger.choices.some(c=>c.value==="needs_service"));
});
test("forbidWhen rejects unsafe and contradictory source rules",()=>{
  const anchor='@forbidWhen("quality","ready")';
  for(const [description,replacement] of [
    ["missing sibling",'@forbidWhen("missing","ready")'],
    ["non-enum sibling",'@forbidWhen("reading","ready")'],
    ["nonexistent enum choice",'@forbidWhen("quality","other_state")'],
    ["self comparison",'@forbidWhen("maintenanceReason","ready")'],
    ["conflicts with required",'@forbidWhen("quality","needs_service")']
  ]){
    const scratch=mkdtempSync(join("examples","vnext",".forbid-when-negative-"));
    try{
      cpSync(join(root,"tspconfig.yaml"),join(scratch,"tspconfig.yaml"));
      cpSync(join(root,"contracts"),join(scratch,"contracts"),{recursive:true});
      const mutated=source.replace(anchor,replacement);
      assert.notEqual(mutated,source);
      writeFileSync(join(scratch,"contracts/main.tsp"),mutated);
      const run=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",scratch],{encoding:"utf8",timeout:90000});
      assert.notEqual(run.status,0,"Invalid rule compiled: "+description);
      assert.match((run.stdout??"")+(run.stderr??""),/protocolia-invalid-forbid-when/i);
    }finally{rmSync(scratch,{recursive:true,force:true});}
  }
});
test("conditional rules reject unknown trigger, unsafe values and always-required targets",()=>{
  const anchor='@requiredWhen("quality","needs_service")';
  for(const [description,replacement] of [
    ["unknown source",'@requiredWhen("unknownField","needs_service")'],
    ["non-enum source",'@requiredWhen("reading","needs_service")'],
    ["undeclared enum value",'@requiredWhen("quality","other_state")'],
    ["self reference",'@requiredWhen("maintenanceReason","needs_service")']
  ]){
    const scratch=mkdtempSync(join("examples","vnext",".required-when-negative-"));
    try{
      cpSync(join(root,"tspconfig.yaml"),join(scratch,"tspconfig.yaml"));
      cpSync(join(root,"contracts"),join(scratch,"contracts"),{recursive:true});
      const mutated=source.replace(anchor,replacement);
      assert.notEqual(mutated,source);
      writeFileSync(join(scratch,"contracts/main.tsp"),mutated);
      const run=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",scratch],{
        encoding:"utf8",timeout:90000
      });
      assert.notEqual(run.status,0,"Unsafe conditional accepted: "+description);
      assert.match((run.stdout??"")+(run.stderr??""),/protocolia-invalid-required-when/i);
    }finally{rmSync(scratch,{recursive:true,force:true});}
  }
});
