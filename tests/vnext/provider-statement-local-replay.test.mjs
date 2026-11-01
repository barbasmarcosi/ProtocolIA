import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,sign} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,
  rmSync,symlinkSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {spawn,spawnSync} from "node:child_process";
import {signedStatementMessage} from "../../packages/adapters/provider-statement-signature.mjs";
import {consumeLocalSignedStatement} from "../../packages/adapters/provider-statement-local-replay.mjs";

const cli=resolve("scripts/vnext/reconcile-provider-statement.mjs");
const payment={receiptId:"PAY-1",orderId:"OT-1",amount:"10.30",currency:"ARS",
  status:"posted",proofState:"unverified"};
const link={receiptId:"PAY-1",providerId:"sandbox",transactionId:"TX-1"};
const capture={providerId:"sandbox",transactionId:"TX-1",eventId:"E-1",
  kind:"capture",amount:"10.30",currency:"ARS"};
const utc=x=>new Date(x).toISOString().replace(".000Z","Z");
function withFixture(fn){
  const dir=mkdtempSync(join(tmpdir(),"pia-local-replay-"));
  try {
    const {publicKey,privateKey}=generateKeyPairSync("ed25519");
    const pem=publicKey.export({type:"spki",format:"pem"});
    const fingerprint=createHash("sha256").update(
      publicKey.export({type:"spki",format:"der"})).digest("hex");
    const bytes=Buffer.from(JSON.stringify([capture]));
    const statementSha256=createHash("sha256").update(bytes).digest("hex");
    const now=Math.floor(Date.now()/1000)*1000;
    const metadata={version:1,providerId:"sandbox",keyId:"key-1",orderId:"OT-1",
      currency:"ARS",scale:2,statementSha256,
      validFrom:utc(now-60000),validUntil:utc(now+3600000)};
    const signed=meta=>({...meta,signature:sign(null,
      signedStatementMessage(meta),privateKey).toString("base64")});
    writeFileSync(join(dir,"internal.json"),JSON.stringify([payment]));
    writeFileSync(join(dir,"links.json"),JSON.stringify([link]));
    writeFileSync(join(dir,"external.json"),bytes);
    writeFileSync(join(dir,"attestation.json"),JSON.stringify(signed(metadata)));
    writeFileSync(join(dir,"key.pem"),pem);
    const guard=join(dir,"private");
    mkdirSync(guard,{mode:0o700});
    const args=[cli,"--internal",join(dir,"internal.json"),
      "--links",join(dir,"links.json"),"--external",join(dir,"external.json"),
      "--currency","ARS","--scale","2","--expected-order","OT-1",
      "--external-attestation",join(dir,"attestation.json"),
      "--provider-public-key",join(dir,"key.pem"),
      "--trusted-key-sha256",fingerprint,"--local-replay-dir",guard];
    const outcome=fn({dir,guard,args,metadata,signed});
    if(outcome && typeof outcome.then==="function")
      return outcome.finally(()=>rmSync(dir,{recursive:true,force:true}));
    rmSync(dir,{recursive:true,force:true});
    return outcome;
  } catch(error) {rmSync(dir,{recursive:true,force:true});throw error;}
}
const run=args=>spawnSync(process.execPath,args,{encoding:"utf8",timeout:15000});
function parallel(args){
  return new Promise((resolveResult,reject)=>{
    const child=spawn(process.execPath,args,{stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="";
    child.stdout.on("data",d=>stdout+=d);
    child.stderr.on("data",d=>stderr+=d);
    child.on("error",reject);
    child.on("close",status=>resolveResult({status,stdout,stderr}));
  });
}
test("signed statement consumed once; second invocation fails closed with no report",()=>{
  withFixture(f=>{
    const first=run(f.args);
    assert.equal(first.status,0,first.stderr);
    const result=JSON.parse(first.stdout);
    assert.equal(result.externalStatementSignature.integrityVerified,true);
    assert.equal(result.externalStatementSignature.replayProtection,"single_host_local_marker");
    assert.equal(result.externalStatementSignature.settlementVerified,false);
    assert.equal(result.independentlyAuthenticated,false);
    assert.match(result.externalStatementSignature.localReplayMarkerSha256,/^[0-9a-f]{64}$/);
    assert.deepEqual(readdirSync(f.guard),[result.externalStatementSignature.localReplayMarkerSha256]);
    const second=run(f.args);
    assert.equal(second.status,1,second.stderr);
    assert.equal(second.stdout,"");
    assert.match(second.stderr,/local replay guard/);
    // Re-signing identical statement bytes under a fresh validity window
    // cannot bypass the digest-based local marker.
    const altered=f.signed({...f.metadata,keyId:"rotated-key"});
    writeFileSync(join(f.dir,"attestation.json"),JSON.stringify(altered));
    assert.equal(run(f.args).status,1);
  });
});
test("10 simultaneous processes have exactly one success for one signed snapshot",async()=>{
  await withFixture(async f=>{
    const results=await Promise.all(Array.from({length:10},()=>parallel(f.args)));
    assert.equal(results.filter(x=>x.status===0).length,1,JSON.stringify(results));
    assert.equal(results.filter(x=>x.status===1).length,9);
    assert.equal(readdirSync(f.guard).length,1);
    for(const rejected of results.filter(x=>x.status===1)) {
      assert.equal(rejected.stdout,"");
      assert.match(rejected.stderr,/local replay guard/);
    }
  });
});
test("invalid signature and invalid inputs cannot burn a replay marker",()=>{
  withFixture(f=>{
    writeFileSync(join(f.dir,"external.json"),JSON.stringify([{...capture,amount:"9.99"}]));
    const tampered=run(f.args);
    assert.equal(tampered.status,1,tampered.stderr);
    assert.equal(tampered.stdout,"");
    assert.equal(readdirSync(f.guard).length,0);
    writeFileSync(join(f.dir,"external.json"),JSON.stringify([capture]));
    writeFileSync(join(f.dir,"links.json"),JSON.stringify([{...link,receiptId:"OTHER"}]));
    const discrepancy=run(f.args);
    assert.equal(discrepancy.status,2,discrepancy.stderr);
    assert.equal(readdirSync(f.guard).length,1,
      "valid comparison with exceptions still consumes the snapshot");
  });
});
test("private owner directory is mandatory; symlink and public directories rejected",()=>{
  withFixture(f=>{
    const bad=join(f.dir,"public");
    mkdirSync(bad,{mode:0o777});chmodSync(bad,0o777);
    assert.equal(run([...f.args.slice(0,-1),bad]).status,1);
    assert.equal(readdirSync(bad).length,0);
    const alias=join(f.dir,"alias");
    symlinkSync(f.guard,alias);
    assert.equal(run([...f.args.slice(0,-1),alias]).status,1);
    assert.equal(readdirSync(f.guard).length,0);
    assert.equal(run([...f.args.slice(0,-1),join(f.dir,"missing")]).status,1);
    assert.equal(readdirSync(f.guard).length,0);
  });
});
test("marker survives failed subsequent attempt; unsigned mode cannot claim replay protection",()=>{
  withFixture(f=>{
    const meta=JSON.parse(readFileSync(join(f.dir,"attestation.json"),"utf8"));
    const first=consumeLocalSignedStatement({directory:f.guard,metadata:meta});
    assert.equal(first.replayProtection,"single_host_local_marker");
    assert.throws(()=>consumeLocalSignedStatement({directory:f.guard,metadata:meta}),
      /local replay guard/);
    assert.equal(readdirSync(f.guard).length,1);
    const unsigned=[cli,"--internal",join(f.dir,"internal.json"),
      "--links",join(f.dir,"links.json"),"--external",join(f.dir,"external.json"),
      "--currency","ARS","--scale","2","--local-replay-dir",f.guard];
    const r=run(unsigned);
    assert.equal(r.status,1);
    assert.equal(r.stdout,"");
    assert.match(r.stderr,/Detached signature/);
  });
});

test("SIGKILL after durable marker before stdout fails closed on restart",()=>{
  withFixture(f=>{
    const meta=JSON.parse(readFileSync(join(f.dir,"attestation.json"),"utf8"));
    const moduleUrl=pathToFileURL(resolve("packages/adapters/provider-statement-local-replay.mjs")).href;
    const childCode=`import {consumeLocalSignedStatement} from ${JSON.stringify(moduleUrl)};
      consumeLocalSignedStatement({directory:${JSON.stringify(f.guard)},metadata:${JSON.stringify(meta)}});
      process.kill(process.pid,"SIGKILL");`;
    const crashed=spawnSync(process.execPath,["--input-type=module","-e",childCode],
      {encoding:"utf8",timeout:10000});
    assert.equal(crashed.signal,"SIGKILL",crashed.stderr);
    assert.equal(crashed.stdout,"");
    assert.equal(readdirSync(f.guard).length,1);
    const retried=run(f.args);
    assert.equal(retried.status,1,retried.stderr);
    assert.equal(retried.stdout,"");
    assert.match(retried.stderr,/local replay guard/);
  });
});
