import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,cpSync,mkdirSync,rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join,resolve} from "node:path";
const original=resolve("examples/vnext/inventory-reservations");
const source=readFileSync(join(original,"contracts/main.tsp"),"utf8");
const variants=[
  ["wrong-stock-field",s=>s.replace('@release("Part", "available", "partSku", "units")',
    '@release("Part", "name", "partSku", "units")'),"protocolia-invalid-release"],
  ["wrong-transition-source",s=>s.replace('@transition("active", "cancelled")',
    '@transition("cancelled", "active")'),"protocolia-invalid-release"],
  ["release-without-debit",s=>s.replace('@reserve("Part", "available", "partSku", "units")',''),
    "protocolia-release-invariant"]
];
const dir=mkdtempSync(join(resolve("examples/vnext"),".a8-negative-"));
try{
  for(const [name,modify,diagnostic] of variants){
    const path=join(dir,name);
    mkdirSync(join(path,"contracts"),{recursive:true});
    cpSync(join(original,"tspconfig.yaml"),join(path,"tspconfig.yaml"));
    const invalid=modify(source);
    assert.notEqual(invalid,source);
    writeFileSync(join(path,"contracts/main.tsp"),invalid);
    const result=spawnSync(resolve("node_modules/.bin/tsp"),["compile",path],
      {encoding:"utf8",timeout:120000});
    assert.notEqual(result.status,0,name+" unexpectedly compiled");
    assert.match(result.stdout+"\n"+result.stderr,new RegExp(diagnostic),
      "Expected TypeSpec diagnostic for "+name);
  }
  console.log("A8_TYPESPEC_INVALID_RELEASE_CONTRACTS_REJECTED_PASS");
}finally{
  rmSync(dir,{recursive:true,force:true});
}
