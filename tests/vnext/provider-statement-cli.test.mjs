import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
const cli=resolve("scripts/vnext/reconcile-provider-statement.mjs");
function run(internal,links,external,internalReturns=undefined,expectedOrder=undefined) {
  const tmp=mkdtempSync(join(tmpdir(),"pia-offline-"));
  try {
    for(const [name,value] of Object.entries({internal,links,external}))
      writeFileSync(join(tmp,name+".json"),JSON.stringify(value));
    const args=[cli,"--internal",join(tmp,"internal.json"),
      "--links",join(tmp,"links.json"),"--external",join(tmp,"external.json"),
      "--currency","ARS","--scale","2"];
    if(internalReturns!==undefined) {
      writeFileSync(join(tmp,"internalReturns.json"),JSON.stringify(internalReturns));
      args.push("--internal-returns",join(tmp,"internalReturns.json"));
    }
    if(expectedOrder!==undefined)args.push("--expected-order",expectedOrder);
    return spawnSync(process.execPath,args,{encoding:"utf8",timeout:10000});
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

test("CLI verifies exact internal refund versus external refund as unverified comparison",()=>{
  const recorded=[{receiptId:"P1",returnId:"REF-1",kind:"refund",
    amount:"0.25",currency:"ARS",status:"recorded"}];
  const reported=[capture,{providerId:"test_provider",transactionId:"T1",
    eventId:"EXT-REF-1",kind:"refund",amount:"0.25",currency:"ARS"}];
  const r=run([payment],[link],reported,recorded);
  assert.equal(r.status,0,r.stderr);
  const output=JSON.parse(r.stdout);
  assert.equal(output.rows[0].classification,"returns_agree_unverified");
  assert.equal(output.rows[0].internalRecordedRefund,"0.25");
  assert.equal(output.totals.internallyRecordedReturns,"0.25");
  assert.equal(output.independentlyAuthenticated,false);
});
test("CLI flags internal-only return and never modifies local journal",()=>{
  const recorded=[{receiptId:"P1",returnId:"REF-1",kind:"refund",
    amount:"0.25",currency:"ARS",status:"recorded"}];
  const before=structuredClone(recorded);
  const r=run([payment],[link],[capture],recorded);
  assert.equal(r.status,2,r.stderr);
  assert.equal(JSON.parse(r.stdout).rows[0].classification,
    "internal_return_not_externally_reported");
  assert.deepEqual(recorded,before);
});

test("malformed external statement never echoes sensitive JSON fragments",()=>{
  const tmp=mkdtempSync(join(tmpdir(),"pia-private-"));
  try {
    writeFileSync(join(tmp,"internal.json"),JSON.stringify([payment]));
    writeFileSync(join(tmp,"links.json"),JSON.stringify([link]));
    writeFileSync(join(tmp,"external.json"),'{"account":"SECRET_ACCOUNT_12345", malformed');
    const r=spawnSync(process.execPath,[cli,"--internal",join(tmp,"internal.json"),
      "--links",join(tmp,"links.json"),"--external",join(tmp,"external.json"),
      "--currency","ARS","--scale","2"],{encoding:"utf8",timeout:10000});
    assert.equal(r.status,1);
    assert.match(r.stderr,/external: invalid JSON/);
    assert.doesNotMatch(r.stderr,/SECRET_ACCOUNT_12345/);
    assert.equal(r.stdout,"");
  }finally{rmSync(tmp,{recursive:true,force:true});}
});

test("optional expected-order scope accepts only the selected nonempty snapshot",()=>{
  const good=run([payment],[link],[capture],undefined,"O1");
  assert.equal(good.status,0,good.stderr);
  const wrong=run([payment],[link],[capture],undefined,"O2");
  assert.equal(wrong.status,1);
  assert.match(wrong.stderr,/outside expected order/);
  assert.equal(wrong.stdout,"");
  const mixed=run([payment,{...payment,receiptId:"P2",orderId:"O2"}],
    [link],[capture],undefined,"O1");
  assert.equal(mixed.status,1);
  assert.equal(mixed.stdout,"");
  const empty=run([],[],[],undefined,"O1");
  assert.equal(empty.status,1);
  assert.equal(empty.stdout,"");
  const invalid=run([payment],[link],[capture],undefined,"O1' OR TRUE");
  assert.equal(invalid.status,1);
});
test("empty exports without expected-order are incomplete, never exit success",()=>{
  const r=run([],[],[]);
  assert.equal(r.status,2,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).exceptions.map(x=>x.code),["empty_internal_snapshot"]);
});
test("symlinked and oversized inputs are rejected without echoing their contents",()=>{
  const tmp=mkdtempSync(join(tmpdir(),"pia-fd-"));
  try {
    const real=join(tmp,"real.json"),linked=join(tmp,"linked.json");
    writeFileSync(real,JSON.stringify([payment]));
    symlinkSync(real,linked);
    const args=[cli,"--internal",linked,"--links",real,"--external",real,
      "--currency","ARS","--scale","2"];
    const linkedResult=spawnSync(process.execPath,args,{encoding:"utf8",timeout:10000});
    assert.equal(linkedResult.status,1,linkedResult.stderr);
    assert.match(linkedResult.stderr,/non-symlink/);
    assert.equal(linkedResult.stdout,"");
    const big=join(tmp,"big.json");
    writeFileSync(big,"["+" ".repeat(4*1024*1024)+"]");
    args[2]=big;
    const oversized=spawnSync(process.execPath,args,{encoding:"utf8",timeout:10000});
    assert.equal(oversized.status,1,oversized.stderr);
    assert.match(oversized.stderr,/4 MiB/);
    assert.equal(oversized.stdout,"");
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
