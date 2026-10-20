import assert from "node:assert/strict";
import {mkdtempSync,cpSync,mkdirSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve,join} from "node:path";
const original=resolve(process.argv[2]);
const contract=resolve(process.argv[3]);
assert.ok(original.includes("/dist/a12-"));
const source=readFileSync(join(contract,"contracts/main.tsp"),"utf8");
const tmp=mkdtempSync(resolve("examples/vnext/.a12-invalid-"));
try{
 mkdirSync(join(tmp,"contracts"),{recursive:true});
 cpSync(join(contract,"tspconfig.yaml"),join(tmp,"tspconfig.yaml"));
 const altered=source.replace('@audit("title,status")','@audit("status")');
 assert.notEqual(altered,source,"A12 negative must actually change an old audited create operation");
 writeFileSync(join(tmp,"contracts/main.tsp"),altered);
 const commands=[
   ["plan",true],
   ["evolve",false]
 ];
 for(const [action,allowed] of commands){
  const result=spawnSync(process.execPath,["packages/cli/protocolia.mjs",action,tmp,original],
    {encoding:"utf8",timeout:300000});
  const log=result.stdout+"\n"+result.stderr;
  assert.match(log,/"compatible":false/,"Historical audit write drift cannot be called compatible");
  assert.match(log,/Operation\/routing\/capability changed: createWorkOrder/);
  if(allowed)assert.equal(result.status,0,log);
  else assert.notEqual(result.status,0,"Unsafe evolve must fail closed");
 }
 console.log("A12_UNSAFE_PREVIOUS_AUDIT_WRITE_EVOLUTION_REFUSED_BEFORE_SWAP_PASS");
}finally{rmSync(tmp,{recursive:true,force:true});}
