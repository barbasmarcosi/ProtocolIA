import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {composeStateOnlyGraph} from "../../scripts/research/state-only-operator-grammar.mjs";
import {checkedMakerGuardDdl,checkedMakerGuardProof}
 from "../../packages/adapters/maker-checker-db-guard.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=(domain,version)=>JSON.parse(readFileSync(join(root,"research/autonomous-engineering/samples",
 "state-only-"+domain+"-"+version+".json"),"utf8"));
const asCompilerIr=source=>{
 const ir=composeStateOnlyGraph(source);
 return {...ir,operations:ir.operations.map(op=>({
  name:op.name,entity:op.entity,capability:op.capability,path:op.path,
  method:["get","listPage","health"].includes(op.kind)?"GET":"POST",
  behavior:{kind:op.kind,...(op.kind==="transition"?
    {field:op.field,from:op.from,to:op.to,audit:op.audit}:{})}
 }))};
};
test("v0.3 and v0.4 do not get maker-checker SQL or schema columns",()=>{
 for(const version of ["v03","v04"]){
  for(const domain of ["review","service-ticket"]){
   const ir=asCompilerIr(read(domain,version));
   assert.deepEqual(checkedMakerGuardDdl(ir,ir.entities[0]),[]);
   assert.equal(checkedMakerGuardProof(ir),null);
  }
 }
});
test("v0.5 approved workflow has a server-only PostgreSQL CHECK plus transaction-subject trigger",()=>{
 for(const domain of ["review","service-ticket"]){
  const ir=asCompilerIr(read(domain,"v05"));
  const sql=checkedMakerGuardDdl(ir,ir.entities[0]);
  assert.equal(sql.length,3);
  assert.match(sql[0],/CHECK \(\(state='(reported|drafted)'\) = \(protocolia_submitted_by IS NULL\)\)/);
  assert.match(sql[1],/OLD.protocolia_submitted_by IS NOT NULL/);
  assert.match(sql[1],/current_setting\('protocolia.subject',true\)/);
  assert.match(sql[1],/NEW.protocolia_submitted_by=verified_subject/);
  assert.match(sql[1],/verified_subject<>OLD.protocolia_submitted_by/);
  assert.match(sql[1],/NEW.protocolia_submitted_by IS DISTINCT FROM OLD.protocolia_submitted_by/);
  assert.match(sql[1],/NEW.state IS DISTINCT FROM OLD.state/);
  assert.match(sql[1],/NEW.state IN \('(completed|approved)','(dismissed|rejected)'\)/);
  assert.match(sql[2],/BEFORE INSERT OR UPDATE/);
  assert.ok(sql.every(x=>!x.includes("DROP TABLE")&&!x.includes("EXECUTE FORMAT")));
  const proof=checkedMakerGuardProof(ir);
  assert.match(proof,/EXCEPTION WHEN check_violation THEN NULL/);
  assert.equal((proof.match(/EXCEPTION WHEN check_violation/g)||[]).length,4);
  assert.match(proof,/protocolia_submitted_by='forged'/);
  assert.match(proof,/No pending maker-checker row for DB proof/);
 }
});
test("invalid privilege, state edge and free-form identifier never render guard DDL",()=>{
 const a=asCompilerIr(read("service-ticket","v05"));
 for(const change of [
  x=>x.operations.find(o=>o.capability==="serviceticket.decide.checked").capability="public",
  x=>x.operations.find(o=>o.capability==="serviceticket.submit").behavior.reserve={stockEntity:"Wallet"},
  x=>x.operations.find(o=>o.capability==="serviceticket.decide.checked").behavior.to="triaged",
  x=>x.entities[0].name="ServiceTicket'; DROP TABLE receipts; --",
  x=>x.operations.push({name:"unsafe",entity:"ServiceTicket",behavior:{kind:"delete"}})
 ]){
  const ir=structuredClone(a);change(ir);
  assert.throws(()=>checkedMakerGuardDdl(ir,ir.entities[0]),/UNSAFE_TRANSITION_AUTHORITY|MAKER_GUARD_UNSAFE/);
 }
});
test("generation preserves identical vetted terminal graph despite operator ordering",()=>{
 const a=asCompilerIr(read("service-ticket","v05"));
 const expected=checkedMakerGuardDdl(a,a.entities[0]);
 a.operations.reverse();
 assert.deepEqual(checkedMakerGuardDdl(a,a.entities[0]),expected);
});
