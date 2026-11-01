import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
const cli=resolve("scripts/vnext/reconcile-provider-statement.mjs");
function run(internal,links,external) {
  const tmp=mkdtempSync(join(tmpdir(),"pia-offline-"));
  try {
    for(const [name,value] of Object.entries({internal,links,external}))
      writeFileSync(join(tmp,name+".json"),JSON.stringify(value));
    return spawnSync(process.execPath,[cli,"--internal",join(tmp,"internal.json"),
      "--links",join(tmp,"links.json"),"--external",join(tmp,"external.json"),
      "--currency","ARS","--scale","2"],{encoding:"utf8",timeout:10000});
  }finally{rmSync(tmp,{recursive:true,force:true});}
}
const payment={receiptId:"P1",orderId:"O1",currency:"ARS",amount:"1.00",
  status:"posted",proofState:"unverified"};
const link={receiptId:"P1",providerId:"test_provider",transactionId:"T1"};
const capture={providerId:"test_provider",transactionId:"T1",eventId:"E1",
  kind:"capture",amount:"1.00",currency:"ARS"};
test("CLI produces deterministic machine-readable non-authoritative result",()=>{
  const r=run([payment],[link],[capture]);
  assert.equal(r.status,0,r.stderr);
  const body=JSON.parse(r.stdout);
  assert.equal(body.rows[0].classification,"amounts_agree_unverified");
  assert.equal(body.independentlyAuthenticated,false);
});
test("CLI flags discrepancies with exit 2, never prints a verified settlement",()=>{
  const r=run([payment],[link],[]);
  assert.equal(r.status,2,r.stderr);
  assert.equal(JSON.parse(r.stdout).rows[0].classification,"missing_external_transaction");
});
test("CLI rejects unsafe numeric input and malformed source without printing money",()=>{
  const r=run([{...payment,amount:1.00}],[link],[capture]);
  assert.equal(r.status,1);
  assert.match(r.stderr,/RECONCILIATION_INPUT_REJECTED/);
  assert.equal(r.stdout,"");
});
