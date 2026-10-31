#!/usr/bin/env node
// Fail-closed negative contract matrix; authoritative TypeSpec compiler must reject
// ambiguous, writable or incorrectly typed charge sources before code generation.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";

const fixture=resolve("examples/vnext/workshop-payment-guard");
const source=readFileSync(join(fixture,"contracts/main.tsp"),"utf8");
const config=readFileSync(join(fixture,"tspconfig.yaml"),"utf8");
const annotation='@reconcileExact("openingBalance","available","Payment","orderNumber","amount","status","posted","reversed","laborCharge,partsCharge", true)';
assert.ok(source.includes(annotation),"Expected frozen multi-source contract");
const column='@encode(string) @exactDecimal(14,2,"0","999999999999.99")\n    partsCharge: decimal;\n    // Exact opening';
assert.ok(source.includes(column),"Expected source field with exact decimal constraints");

const cases=[
  ["missing",source.replace(annotation,annotation.replace("laborCharge,partsCharge","noSuchSource,partsCharge"))],
  ["wrong-type",source.replace(annotation,annotation.replace("laborCharge,partsCharge","symptom,partsCharge"))],
  ["self-alias",source.replace(annotation,annotation.replace("laborCharge,partsCharge","openingBalance,partsCharge"))],
  ["nullable-source",source.replace("partsCharge: decimal;\n    // Exact opening","partsCharge?: decimal;\n    // Exact opening")],
  ["wrong-scale-source",source.replace(column,column.replace('14,2,"0","999999999999.99"','14,3,"0","99999999999.999"'))],
  ["negative-source",source.replace(column,column.replace('14,2,"0"','14,2,"-1.00"'))],
  ["computed-source",source.replace(column,column.replace('    partsCharge: decimal;', '    @computedRoundedProduct("laborCharge","laborCharge","half_up") partsCharge: decimal;'))],
  ["duplicate-source",source.replace(annotation,annotation.replace("laborCharge,partsCharge","laborCharge,laborCharge"))],
  ["too-many-sources",source.replace(annotation,annotation.replace("laborCharge,partsCharge","laborCharge,partsCharge,symptom,status,number"))],
  ["spoofed-create-dto",source.replace("model WorkOrderRequest {",'model WorkOrderRequest {\n    @encode(string) @exactDecimal(14,2,"0","999999999999.99") openingBalance: decimal;')]
];
const temp=mkdtempSync(resolve("examples/vnext/.multi-charge-negative-"));
try{
  mkdirSync(join(temp,"contracts"),{recursive:true});
  writeFileSync(join(temp,"tspconfig.yaml"),config);
  for(const [name,invalid] of cases){
    assert.notEqual(invalid,source,"Fixture mutation must change TypeSpec: "+name);
    writeFileSync(join(temp,"contracts/main.tsp"),invalid);
    const test=spawnSync(resolve("node_modules/.bin/tsp"),["compile",temp],{
      encoding:"utf8",timeout:90000,maxBuffer:4*1024*1024
    });
    const output=(test.stdout??"")+"\n"+(test.stderr??"");
    assert.equal(test.status,1,"Unsafe source must be rejected: "+name+" "+output.slice(-900));
    const expected=name==="spoofed-create-dto"?
      /protocolia-server-only-request-spoof/:/protocolia-invalid-exact-charge-source/;
    assert.match(output,expected,"Wrong diagnostic for "+name+" "+output.slice(-1100));
    console.log("PROTOCOLIA_MULTICHARGE_COMPILE_REJECT_PASS "+name);
  }
}finally{
  rmSync(temp,{recursive:true,force:true});
}
