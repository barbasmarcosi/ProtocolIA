import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,cpSync,rmSync,mkdirSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve,join} from "node:path";

const root=resolve("examples/vnext/work-orders");
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const variants=[
  ["same-source-and-target",
    s=>s.replace('@transition("draft", "approved")','@transition("draft", "draft")'),
    "protocolia-invalid-transition"],
  ["missing-initial",
    s=>s.replace('@initial("draft") @minLength(1) @maxLength(20)','@minLength(1) @maxLength(20)'),
    "protocolia-invalid-transition"],
  ["unprotected-write",
    s=>s.replace('@transition("draft", "approved")\n  @audit("status")\n  @capability("orders.write")',
      '@transition("draft", "approved")\n  @audit("status")\n  @capability("public")'),
    "protocolia-public-write"],
];
const original=resolve("examples/vnext");
const scratch=mkdtempSync(join(original,".a6-negative-"));
try{
  for(const [name,mutate,diagnostic] of variants){
    const directory=join(scratch,name);
    mkdirSync(join(directory,"contracts"),{recursive:true});
    cpSync(join(root,"tspconfig.yaml"),join(directory,"tspconfig.yaml"));
    const modified=mutate(source);
    assert.notEqual(modified,source,"Invalid fixture transformation must have an effect: "+name);
    writeFileSync(join(directory,"contracts/main.tsp"),modified);
    const result=spawnSync(resolve("node_modules/.bin/tsp"),["compile",directory],
      {encoding:"utf8",timeout:120000});
    assert.notEqual(result.status,0,name+" unexpectedly compiled");
    assert.match(result.stdout+"\n"+result.stderr,new RegExp(diagnostic),
      "Expected compiler diagnostic for "+name);
  }
  console.log("A6_INVALID_STATE_TRANSITIONS_AND_PUBLIC_WRITE_REJECTED_PASS");
}finally{
  rmSync(scratch,{recursive:true,force:true});
}
