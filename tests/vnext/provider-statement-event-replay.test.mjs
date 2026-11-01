import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync,
  symlinkSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawn,spawnSync} from "node:child_process";
import {signedStatementMessage} from "../../packages/adapters/provider-statement-signature.mjs";
import {consumeLocalSignedEvents} from "../../packages/adapters/provider-statement-event-replay.mjs";

const cli=resolve("scripts/vnext/reconcile-provider-statement.mjs");
const sha=value=>createHash("sha256").update(value).digest("hex");
const utc=value=>new Date(value).toISOString().replace(".000Z","Z");
const payment={receiptId:"PAY-1",orderId:"OT-1",amount:"10.30",currency:"ARS",
  status:"posted",proofState:"unverified"};
const link={receiptId:"PAY-1",providerId:"sandbox",transactionId:"TX-1"};
const event={providerId:"sandbox",transactionId:"TX-1",eventId:"E-1",
  kind:"capture",amount:"10.30",currency:"ARS"};
const run=args=>spawnSync(process.execPath,args,{encoding:"utf8",timeout:15000});
function parallel(args) {
  return new Promise((resolveResult,reject)=>{
    const child=spawn(process.execPath,args,{stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="";
    child.stdout.on("data",chunk=>stdout+=chunk);
    child.stderr.on("data",chunk=>stderr+=chunk);
    child.on("error",reject);
    child.on("close",status=>resolveResult({status,stdout,stderr}));
  });
}
function withFixture(fn) {
  const dir=mkdtempSync(join(tmpdir(),"pia-event-replay-"));
  try {
    const {publicKey,privateKey}=generateKeyPairSync("ed25519");
    const pem=publicKey.export({type:"spki",format:"pem"});
    const fingerprint=sha(publicKey.export({type:"spki",format:"der"}));
    const now=Math.floor(Date.now()/1000)*1000;
    const base={version:1,providerId:"sandbox",keyId:"key-1",orderId:"OT-1",
      currency:"ARS",scale:2,validFrom:utc(now-60000),validUntil:utc(now+3600000)};
    const signMetadata=metadata=>({...metadata,signature:sign(null,
      signedStatementMessage(metadata),privateKey).toString("base64")});
    const setEvents=(events,space=0)=>{
      const bytes=JSON.stringify(events,null,space);
      const metadata=signMetadata({...base,statementSha256:sha(bytes)});
      writeFileSync(join(dir,"external.json"),bytes);
      writeFileSync(join(dir,"attestation.json"),JSON.stringify(metadata));
      return metadata;
    };
    writeFileSync(join(dir,"internal.json"),JSON.stringify([payment]));
    writeFileSync(join(dir,"links.json"),JSON.stringify([link]));
    writeFileSync(join(dir,"key.pem"),pem);
    const metadata=setEvents([event]);
    const guard=join(dir,"private");
    mkdirSync(guard,{mode:0o700});
    const args=[cli,"--internal",join(dir,"internal.json"),
      "--links",join(dir,"links.json"),"--external",join(dir,"external.json"),
      "--currency","ARS","--scale","2","--expected-order","OT-1",
      "--external-attestation",join(dir,"attestation.json"),
      "--provider-public-key",join(dir,"key.pem"),
      "--trusted-key-sha256",fingerprint,"--local-event-replay-dir",guard];
    const value=fn({dir,guard,args,metadata,setEvents});
    if(value && typeof value.then==="function")
      return value.finally(()=>rmSync(dir,{recursive:true,force:true}));
    rmSync(dir,{recursive:true,force:true});
    return value;
  } catch(error) {rmSync(dir,{recursive:true,force:true});throw error;}
}
test("one signed event consumed once, re-encoded signed bytes still rejected",()=>{
  withFixture(f=>{
    const first=run(f.args);
    assert.equal(first.status,0,first.stderr);
    const proof=JSON.parse(first.stdout).externalStatementSignature;
    assert.equal(proof.replayProtection,"single_host_local_event_markers");
    assert.equal(proof.consumedEventCount,1);
    assert.equal(proof.providerIdentityVerified,false);
    assert.equal(proof.settlementVerified,false);
    assert.equal(readdirSync(f.guard).filter(name=>name.startsWith("event-")).length,1);
    const again=run(f.args);
    assert.equal(again.status,1,again.stderr);
    assert.equal(again.stdout,"");
    f.setEvents([event],2); // Same event ID, different bytes and valid new signature.
    const encoded=run(f.args);
    assert.equal(encoded.status,1,encoded.stderr);
    assert.equal(encoded.stdout,"");
    assert.equal(readdirSync(f.guard).length,1);
  });
});
test("overlapping reissued statement refuses all new events; disjoint event can later pass",()=>{
  withFixture(f=>{
    assert.equal(run(f.args).status,0);
    const fresh={...event,eventId:"E-2",kind:"refund",amount:"0.25"};
    f.setEvents([event,fresh]);
    const overlap=run(f.args);
    assert.equal(overlap.status,1,overlap.stderr);
    assert.equal(overlap.stdout,"");
    assert.equal(readdirSync(f.guard).length,1,
      "preflight duplicate cannot consume unrelated events or leave a lock");
    f.setEvents([fresh]);
    const independent=run(f.args);
    assert.equal(independent.status,2,independent.stderr);
    assert.equal(JSON.parse(independent.stdout).externalStatementSignature.consumedEventCount,1);
    assert.equal(readdirSync(f.guard).filter(name=>name.startsWith("event-")).length,2);
  });
});
test("ten simultaneous processes accept at most one signed event snapshot",async()=>{
  await withFixture(async f=>{
    const results=await Promise.all(Array.from({length:10},()=>parallel(f.args)));
    assert.equal(results.filter(r=>r.status===0).length,1,JSON.stringify(results));
    assert.equal(results.filter(r=>r.status===1).length,9);
    for(const r of results.filter(r=>r.status===1)) {
      assert.equal(r.stdout,"");
      assert.match(r.stderr,/local event replay guard/);
    }
    assert.equal(readdirSync(f.guard).length,1);
  });
});
test("stale provider lock from interrupted write blocks all new events, no silent recovery",()=>{
  withFixture(f=>{
    const lock=".pia-event-lock-"+sha(JSON.stringify([
      "ProtocolIA-S2C-provider-lock-v1","sandbox"]));
    writeFileSync(join(f.guard,lock),"interrupted\n",{mode:0o600});
    const blocked=run(f.args);
    assert.equal(blocked.status,1,blocked.stderr);
    assert.equal(blocked.stdout,"");
    assert.deepEqual(readdirSync(f.guard),[lock]);
  });
});
test("invalid signed data and private-directory violations cannot consume events",()=>{
  withFixture(f=>{
    writeFileSync(join(f.dir,"external.json"),JSON.stringify([{...event,amount:"9.99"}]));
    assert.equal(run(f.args).status,1);
    assert.equal(readdirSync(f.guard).length,0);
    f.setEvents([event]);
    const publicDir=join(f.dir,"public");
    mkdirSync(publicDir);chmodSync(publicDir,0o777);
    assert.equal(run([...f.args.slice(0,-1),publicDir]).status,1);
    const alias=join(f.dir,"alias");
    symlinkSync(f.guard,alias);
    assert.equal(run([...f.args.slice(0,-1),alias]).status,1);
    assert.equal(readdirSync(f.guard).length,0);
    const dual=run([...f.args,"--local-replay-dir",f.guard]);
    assert.equal(dual.status,1);
    assert.equal(dual.stdout,"");
  });
});
test("direct guard rejects duplicate IDs, provider mismatches, empty or oversized sets",()=>{
  withFixture(f=>{
    for(const external of [
      [],[event,event],[{...event,providerId:"other"}],
      [{...event,eventId:123}], [{...event,transactionId:123}],
      Array.from({length:513},(_,i)=>({...event,eventId:"E-"+i}))
    ]) {
      assert.throws(()=>consumeLocalSignedEvents({
        directory:f.guard,metadata:f.metadata,external}),/local event replay guard/);
      assert.equal(readdirSync(f.guard).length,0);
    }
  });
});

test("event identity is provider-wide across orders within one tenant directory",()=>{
  withFixture(f=>{
    const first=consumeLocalSignedEvents({
      directory:f.guard,metadata:f.metadata,external:[event]});
    assert.equal(first.consumedEventCount,1);
    const otherOrder={...f.metadata,orderId:"OT-2"};
    assert.throws(()=>consumeLocalSignedEvents({
      directory:f.guard,metadata:otherOrder,external:[event]}),
    /local event replay guard/);
    assert.equal(readdirSync(f.guard).length,1);
  });
});
