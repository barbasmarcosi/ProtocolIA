#!/usr/bin/env node
// Compiler red tests: invalid source-declared charges MUST fail closed.
// No production resources, no adapter special cases, no test fixture edits.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
const fixtures=resolve("examples/vnext/workshop-payment-guard");
const source=readFileSync(join(fixtures,"contracts/main.tsp"),"utf8");
const config=readFileSync(join(fixtures,"tspconfig.yaml"),"utf8");
const exact='@reconcileExact("openingBalance","available","Payment","orderNumber","amount","status","posted","reversed","laborCharge", true)';
assert.ok(source.includes(exact),"Source-bound reconciliation must remain the oracle");
const cases=[
  ["missing",exact.replace('"laborCharge", true)','"noSuchSource", true)')],
  ["wrong-type",exact.replace('"laborCharge", true)','"symptom", true)')],
  ["self-alias",exact.replace('"laborCharge", true)','"openingBalance", true)')],
  ["server-only-without-source",exact.replace('"laborCharge", true)', '"", true')],
  ["spoofed-create-dto",null]
];
const tmp=mkdtempSync(resolve("examples/vnext/.charge-source-negative-"));
try{
  mkdirSync(join(tmp,"contracts"),{recursive:true});
  writeFileSync(join(tmp,"tspconfig.yaml"),config);
  for(const [name,replacement] of cases){
    const invalid=name==="spoofed-create-dto"?
      source.replace('model WorkOrderRequest {','model WorkOrderRequest {\n    @encode(string) @exactDecimal(14,2,"0","999999999999.99") openingBalance: decimal;'):
      source.replace(exact,replacement);
    writeFileSync(join(tmp,"contracts/main.tsp"),invalid);
    const run=spawnSync(resolve("node_modules/.bin/tsp"),["compile",tmp],{
      encoding:"utf8",timeout:90000,maxBuffer:4*1024*1024
    });
    assert.equal(run.status,1,"Invalid source must be rejected: "+name+
      " "+(run.stdout??"").slice(-700));
    const output=(run.stdout??"")+"\n"+(run.stderr??"");
    assert.match(output,name==="server-only-without-source"?
      /protocolia-invalid-server-only-balance/:name==="spoofed-create-dto"?
      /protocolia-server-only-request-spoof/:/protocolia-invalid-exact-charge-source/,
      "Wrong reason for source rejection "+name+" "+output.slice(-1200));
    console.log("PROTOCOLIA_EXACT_SOURCE_COMPILE_REJECT_PASS "+name);
  }
}finally{
  rmSync(tmp,{recursive:true,force:true});
}
