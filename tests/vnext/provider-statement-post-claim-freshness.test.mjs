import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {signedStatementMessage} from "../../packages/adapters/provider-statement-signature.mjs";

const cli=resolve("scripts/vnext/reconcile-provider-statement.mjs");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const utc=ms=>new Date(ms).toISOString().replace(".000Z","Z");
const payment={receiptId:"PAY-1",orderId:"OT-1",amount:"10.30",currency:"ARS",
  status:"posted",proofState:"unverified"};
const link={receiptId:"PAY-1",providerId:"sandbox",transactionId:"TX-1"};
const event={providerId:"sandbox",transactionId:"TX-1",eventId:"E-1",
  kind:"capture",amount:"10.30",currency:"ARS"};

// The preload mutates a real financial input only AFTER the replay guard
// has written its event or statement marker and fsynced its directory.
// This exercises the production CLI boundary without test-only production
// hooks, sleeps, timing assumptions, or external payment operations.
const preload=String.raw\`import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
const original=fs.fsyncSync;
let injected=false;
fs.fsyncSync=fd=>{
  const result=original(fd);
  if(!injected && fs.fstatSync(fd).isDirectory()) {
    const names=fs.readdirSync(process.env.PIA_GUARD);
    if(names.some(n=>n.startsWith("event-") || /^[0-9a-f]{64}$/.test(n))) {
      injected=true;
      fs.writeFileSync(process.env.PIA_SOURCE,process.env.PIA_REPLACEMENT);
    }
  }
  return result;
};
syncBuiltinESMExports();\`;

function withFixture(fn) {
  const dir=mkdtempSync(join(tmpdir(),"pia-postclaim-freshness-"));
  try {
    const {publicKey,privateKey}=generateKeyPairSync("ed25519");
    const externalBytes=JSON.stringify([event]);
    const now=Math.floor(Date.now()/1000)*1000;
    const metadata={version:1,providerId:"sandbox",keyId:"key-1",orderId:"OT-1",
      currency:"ARS",scale:2,statementSha256:sha(externalBytes),
      validFrom:utc(now-60000),validUntil:utc(now+3600000)};
    const attestation={...metadata,signature:sign(null,
      signedStatementMessage(metadata),privateKey).toString("base64")};
    writeFileSync(join(dir,"internal.json"),JSON.stringify([payment]));
    writeFileSync(join(dir,"links.json"),JSON.stringify([link]));
    writeFileSync(join(dir,"external.json"),externalBytes);
    writeFileSync(join(dir,"attestation.json"),JSON.stringify(attestation));
    writeFileSync(join(dir,"key.pem"),publicKey.export({type:"spki",format:"pem"}));
    writeFileSync(join(dir,"mutate-after-fsync.mjs"),preload);
    const guard=join(dir,"private");
    mkdirSync(guard,{mode:0o700});
    const base=[cli,"--internal",join(dir,"internal.json"),
      "--links",join(dir,"links.json"),"--external",join(dir,"external.json"),
      "--currency","ARS","--scale","2","--expected-order","OT-1",
      "--expected-provider","sandbox",
      "--external-attestation",join(dir,"attestation.json"),
      "--provider-public-key",join(dir,"key.pem"),
      "--trusted-key-sha256",sha(publicKey.export({type:"spki",format:"der"}))];
    return fn({dir,guard,base,preloadPath:join(dir,"mutate-after-fsync.mjs")});
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
}
const run=(args,env)=>spawnSync(process.execPath,args,{
  encoding:"utf8",timeout:15000,...(env?{env:{...process.env,...env}}:{})
});

for(const mode of ["--local-event-replay-dir","--local-replay-dir"]) {
  test(mode+" clean signed claim still publishes one verified comparison",()=>{
    withFixture(f=>{
      const accepted=run([...f.base,mode,f.guard]);
      assert.equal(accepted.status,0,accepted.stderr);
      const report=JSON.parse(accepted.stdout);
      assert.equal(report.externalStatementSignature.integrityVerified,true);
      assert.equal(report.externalStatementSignature.settlementVerified,false);
      assert.equal(readdirSync(f.guard).length,1);
      const duplicate=run([...f.base,mode,f.guard]);
      assert.equal(duplicate.status,1,duplicate.stderr);
      assert.equal(duplicate.stdout,"");
    });
  });
}

const mutations=[
  {mode:"--local-event-replay-dir",name:"internal",
    replacement:JSON.stringify([{...payment,status:"voided"}])},
  {mode:"--local-event-replay-dir",name:"external",
    replacement:JSON.stringify([{...event,amount:"9.99"}])},
  {mode:"--local-replay-dir",name:"links",
    replacement:JSON.stringify([{...link,receiptId:"OTHER"}])},
  {mode:"--local-replay-dir",name:"attestation",
    replacement:JSON.stringify({invalid:true})}
];
for(const {mode,name,replacement} of mutations) {
  test(mode+" refuses stale "+name+" input mutated after durable claim",()=>{
    withFixture(f=>{
      const args=["--import",f.preloadPath,...f.base,mode,f.guard];
      const rejected=run(args,{PIA_GUARD:f.guard,
        PIA_SOURCE:join(f.dir,name+".json"),PIA_REPLACEMENT:replacement});
      assert.equal(rejected.status,1,rejected.stderr);
      assert.equal(rejected.stdout,"","no stale comparison may be published");
      assert.match(rejected.stderr,/input changed after snapshot read/,
        "post-claim snapshot fence must detect the mutation");
      assert.equal(readdirSync(f.guard).length,1,
        "durable replay evidence must not be rolled back after late failure");
      const replay=run([...f.base,mode,f.guard]);
      assert.equal(replay.status,1,replay.stderr);
      assert.equal(replay.stdout,"");
    });
  });
}
