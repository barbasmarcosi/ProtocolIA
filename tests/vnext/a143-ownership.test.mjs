import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {sealApp,verifyApp} from "../../packages/cli/ownership.mjs";

test("A14.3 generated rule manifest is owned and tampering blocks in-place evolution",()=>{
 const dir=mkdtempSync(join(tmpdir(),"pia-rule-ownership-"));
 try{
  for(const path of ["protocolia-build.json","protocolia-contract-ir.json","protocolia-contract-openapi.json"])
    writeFileSync(join(dir,path),"{}\n");
  const manifest=join(dir,"protocolia-overdue-rules.json");
  writeFileSync(manifest,'[{"key":"Ticket.overdue"}]\n');
  const seal=sealApp(dir);
  assert.ok(seal.files["protocolia-overdue-rules.json"]);
  assert.doesNotThrow(()=>verifyApp(dir));
  writeFileSync(manifest,'[{"key":"Ticket.overdue","channel":"external"}]\n');
  assert.throws(()=>verifyApp(dir),/Managed files modified/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
