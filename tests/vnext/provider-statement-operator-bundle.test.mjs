import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {spawnSync} from "node:child_process";
import {operatorSnapshotMessage,verifyOperatorSnapshotBundle} from
  "../../packages/adapters/provider-statement-operator-bundle.mjs";
import {signedStatementMessage} from "../../packages/adapters/provider-statement-signature.mjs";

const cli=resolve("scripts/vnext/reconcile-provider-statement.mjs");
const sha=value=>createHash("sha256").update(value).digest("hex");
const timestamp=ms=>new Date(ms).toISOString().replace(".000Z","Z");
const run=args=>spawnSync(process.execPath,args,{encoding:"utf8",timeout:15000});
function fixture(fn,{provider=false,returns=true}={}) {
  const dir=mkdtempSync(join(tmpdir(),"pia-operator-bundle-"));
  try {
    const keys=generateKeyPairSync("ed25519");
    const pub=keys.publicKey.export({type:"spki",format:"pem"});
    const fp=sha(keys.publicKey.export({type:"spki",format:"der"}));
    const json={internal:[{receiptId:"P1",orderId:"O1",amount:"1.00",
      currency:"ARS",status:"posted",proofState:"unverified"}],
      links:[{receiptId:"P1",providerId:"demo",transactionId:"T1"}],
      external:[{providerId:"demo",transactionId:"T1",eventId:"E1",
        kind:"capture",amount:"1.00",currency:"ARS"},
        {providerId:"demo",transactionId:"T1",eventId:"E2",
        kind:"refund",amount:"0.25",currency:"ARS"}],
      internalReturns:[{receiptId:"P1",returnId:"R1",kind:"refund",
        amount:"0.25",currency:"ARS",status:"recorded"}]
    };
    const paths=Object.fromEntries(Object.keys(json).map(name=>[name,join(dir,name+".json")]));
    const put=(name,rows)=>writeFileSync(paths[name],JSON.stringify(rows));
    for(const [name,rows] of Object.entries(json))put(name,rows);
    writeFileSync(join(dir,"operator.pem"),pub);
    const now=Math.floor(Date.now()/1000)*1000;
    const base={version:1,orderId:"O1",currency:"ARS",scale:2,
      internalSha256:sha(JSON.stringify(json.internal)),
      internalReturnsSha256:returns?sha(JSON.stringify(json.internalReturns)):null,
      linksSha256:sha(JSON.stringify(json.links)),
      externalSha256:sha(JSON.stringify(json.external)),
      validFrom:timestamp(now-60000),validUntil:timestamp(now+3600000)};
    const signMeta=meta=>({...meta,signature:sign(null,
      operatorSnapshotMessage(meta),keys.privateKey).toString("base64")});
    const signBundle=meta=>{
      const signed=signMeta(meta);
      writeFileSync(join(dir,"bundle.json"),JSON.stringify(signed));
      return signed;
    };
    const signed=signBundle(base);
    const args=[cli,"--internal",paths.internal,"--links",paths.links,
      "--external",paths.external,"--currency","ARS","--scale","2",
      "--expected-order","O1",
      "--operator-bundle-manifest",join(dir,"bundle.json"),
      "--operator-public-key",join(dir,"operator.pem"),
      "--trusted-operator-key-sha256",fp];
    if(returns)args.push("--internal-returns",paths.internalReturns);
    const guard=join(dir,"replay");
    if(provider) {
      const providerKey=generateKeyPairSync("ed25519");
      const providerPem=providerKey.publicKey.export({type:"spki",format:"pem"});
      const providerPin=sha(providerKey.publicKey.export({type:"spki",format:"der"}));
      writeFileSync(join(dir,"provider.pem"),providerPem);
      const attestation={version:1,providerId:"demo",keyId:"provider-key",orderId:"O1",
        currency:"ARS",scale:2,statementSha256:base.externalSha256,
        validFrom:base.validFrom,validUntil:base.validUntil};
      writeFileSync(join(dir,"provider-attestation.json"),JSON.stringify({
        ...attestation,signature:sign(null,signedStatementMessage(attestation),
          providerKey.privateKey).toString("base64")
      }));
      mkdirSync(guard,{mode:0o700});
      args.push("--expected-provider","demo",
        "--external-attestation",join(dir,"provider-attestation.json"),
        "--provider-public-key",join(dir,"provider.pem"),
        "--trusted-key-sha256",providerPin,
        "--local-event-replay-dir",guard);
    }
    return fn({dir,args,guard,base,signed,signBundle,signMeta,put,json,paths,fp,
      publicKeyPem:pub});
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test("independently pinned operator attestation binds all inputs; does not prove settlement",()=>{
  fixture(f=>{
    const r=run(f.args);
    assert.equal(r.status,0,r.stderr);
    const report=JSON.parse(r.stdout);
    assert.equal(report.rows[0].classification,"returns_agree_unverified");
    assert.deepEqual(report.operatorSnapshotAttestation,{
      exactInputBytesBound:true,operatorKeyFingerprint:f.fp,
      validUntil:f.base.validUntil,providerIdentityVerified:false,
      settlementVerified:false
    });
    assert.equal(report.independentlyAuthenticated,false);
  });
});
test("changing any covered source after signing fails before a report",()=>{
  for(const name of ["internal","internalReturns","links","external"]) {
    fixture(f=>{
      const original=f.json[name];
      // A separately valid JSON source with semantically plausible edits
      // must still fail the cryptographic binding, not just the comparator.
      const edited=structuredClone(original);
      if(name==="internal")edited[0].amount="0.99";
      if(name==="internalReturns")edited[0].amount="0.20";
      if(name==="links")edited[0].transactionId="T2";
      if(name==="external")edited[0].amount="0.99";
      f.put(name,edited);
      const invalid=run(f.args);
      assert.equal(invalid.status,1,name+": "+invalid.stderr);
      assert.equal(invalid.stdout,"");
      assert.match(invalid.stderr,/operator bundle: invalid/);
      f.put(name,original);
      const valid=run(f.args);
      assert.equal(valid.status,0,valid.stderr);
    });
  }
});
test("missing optional journal has a distinct signed ABSENT representation",()=>{
  fixture(f=>{
    const r=run(f.args);
    assert.equal(r.status,2,r.stderr); // External refund with no local journal.
    const report=JSON.parse(r.stdout);
    assert.equal(report.operatorSnapshotAttestation.exactInputBytesBound,true);
    assert.deepEqual(report.exceptions.map(x=>x.code),["external_return_requires_review"]);
    const forged=run([...f.args,"--internal-returns",f.paths.internalReturns]);
    assert.equal(forged.status,1);
    assert.equal(forged.stdout,"");
    assert.match(forged.stderr,/operator bundle/);
  },{returns:false});
});
test("operator key mismatch, expired envelope, wrong order, altered signature and missing flags fail",()=>{
  fixture(f=>{
    const wrongPin=run(f.args.map(x=>x===f.fp?"0".repeat(64):x));
    assert.equal(wrongPin.status,1);assert.equal(wrongPin.stdout,"");
    f.signBundle({...f.base,validUntil:timestamp(Date.now()-1000)});
    const expired=run(f.args);
    assert.equal(expired.status,1);assert.equal(expired.stdout,"");
    f.signBundle(f.base);
    const changedSignature={...f.signed,signature:"A"+f.signed.signature.slice(1)};
    writeFileSync(join(f.dir,"bundle.json"),JSON.stringify(changedSignature));
    const tampered=run(f.args);
    assert.equal(tampered.status,1);assert.equal(tampered.stdout,"");
    f.signBundle(f.base);
    const badOrder=run(f.args.map(x=>x==="O1"?"O2":x));
    assert.equal(badOrder.status,1);assert.equal(badOrder.stdout,"");
    const keyIndex=f.args.indexOf("--trusted-operator-key-sha256");
    const missing=run(f.args.filter((_,index)=>index!==keyIndex && index!==keyIndex+1));
    assert.equal(missing.status,1);assert.equal(missing.stdout,"");
    assert.match(missing.stderr,/trust flags/);
  });
});
test("signed provider replay markers are not consumed when operator bundle is stale",()=>{
  fixture(f=>{
    f.put("links",[{...f.json.links[0],transactionId:"OTHER"}]);
    const bad=run(f.args);
    assert.equal(bad.status,1,bad.stderr);
    assert.equal(bad.stdout,"");
    assert.equal(readdirSync(f.guard).length,0,
      "invalid operator-bound mapping must not burn any replay IDs");
    f.put("links",f.json.links);
    const good=run(f.args);
    assert.equal(good.status,0,good.stderr);
    const report=JSON.parse(good.stdout);
    assert.equal(report.operatorSnapshotAttestation.exactInputBytesBound,true);
    assert.equal(report.externalStatementSignature.consumedEventCount,2);
    assert.equal(readdirSync(f.guard).filter(n=>n.startsWith("event-")).length,2);
    const replay=run(f.args);
    assert.equal(replay.status,1,replay.stderr);
    assert.equal(replay.stdout,"");
  },{provider:true});
});
test("direct verifier rejects impossible key/signature, forged scope and manifest shape",()=>{
  fixture(f=>{
    const snapshots={internal:f.base.internalSha256,
      internalReturns:f.base.internalReturnsSha256,
      links:f.base.linksSha256,external:f.base.externalSha256};
    const params={metadata:f.signed,snapshots,expectedOrder:"O1",
      currency:"ARS",scale:2,publicKeyPem:f.publicKeyPem,
      trustedKeySha256:f.fp};
    assert.equal(verifyOperatorSnapshotBundle(params).exactInputBytesBound,true);
    for(const metadata of [
      {...f.signed,extra:"untrusted"},
      {...f.signed,orderId:"O2"},
      {...f.signed,internalReturnsSha256:null},
      {...f.signed,linksSha256:"0".repeat(64)},
      {...f.signed,scale:3},
      {...f.signed,signature:"***"}
    ])assert.throws(()=>verifyOperatorSnapshotBundle({...params,metadata}),/operator bundle/);
  });
});
