import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,sign} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,openSync,closeSync,fstatSync,lstatSync,readSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {signedStatementMessage,verifyDetachedStatement,readPinnedPublicKey} from "../../packages/adapters/provider-statement-signature.mjs";
import {loadStatementArrayWithDigest,loadStatementObject} from "../../packages/adapters/provider-statement-input.mjs";

const cli=resolve("scripts/vnext/reconcile-provider-statement.mjs");
const payment={receiptId:"PAY-1",orderId:"OT-1",amount:"10.30",currency:"ARS",
  status:"posted",proofState:"unverified"};
const link={receiptId:"PAY-1",providerId:"sandbox",transactionId:"TX-1"};
const capture={providerId:"sandbox",transactionId:"TX-1",eventId:"E-1",
  kind:"capture",amount:"10.30",currency:"ARS"};
const utc=millis=>new Date(millis).toISOString().replace(".000Z","Z");
function fixture(){
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const pem=publicKey.export({type:"spki",format:"pem"});
  const fingerprint=createHash("sha256").update(
    publicKey.export({type:"spki",format:"der"})).digest("hex");
  const bytes=Buffer.from(JSON.stringify([capture]));
  const statementSha256=createHash("sha256").update(bytes).digest("hex");
  const now=Math.floor(Date.now()/1000)*1000;
  const metadata={version:1,providerId:"sandbox",keyId:"key-2026",orderId:"OT-1",
    currency:"ARS",scale:2,statementSha256,
    validFrom:utc(now-60000),validUntil:utc(now+3600000)};
  const signed=source=>({...source,signature:sign(null,
    signedStatementMessage(source),privateKey).toString("base64")});
  return {pem,fingerprint,bytes,metadata:signed(metadata),signed,now};
}
function check(f,overrides={}){
  return verifyDetachedStatement({
    metadata:f.metadata,statementSha256:f.metadata.statementSha256,
    external:[capture],expectedOrder:"OT-1",expectedProvider:"sandbox",currency:"ARS",scale:2,
    publicKeyPem:f.pem,trustedKeySha256:f.fingerprint,now:f.now,...overrides
  });
}
test("Ed25519 verifies exact bytes under explicit out-of-band SPKI pin, without settlement authority",()=>{
  const f=fixture(),proof=check(f);
  assert.equal(proof.integrityVerified,true);
  assert.equal(proof.providerIdentityVerified,false);
  assert.equal(proof.settlementVerified,false);
  assert.equal(proof.replayProtection,"none_offline");
  assert.equal(check(f).statementSha256,proof.statementSha256,
    "offline replay is not prevented and must never be claimed to be");
});
test("rejects tamper, key substitution, wrong order/currency/provider and signature changes",()=>{
  const f=fixture();
  const wrong=generateKeyPairSync("ed25519").publicKey.export({type:"spki",format:"pem"});
  const invalid=[
    {statementSha256:"0".repeat(64)},
    {publicKeyPem:wrong},
    {trustedKeySha256:"f".repeat(64)},
    {expectedOrder:"OT-2"},
    {expectedProvider:"other"},
    {expectedProvider:"sandbox/other"},
    {metadata:f.signed({...f.metadata,providerId:"other",signature:undefined}),
      external:[{...capture,providerId:"other"}]},
    {currency:"USD"},
    {scale:3},
    {external:[{...capture,providerId:"other"}]},
    {metadata:{...f.metadata,signature:"A".repeat(86)+"=="}},
    {metadata:{...f.metadata,orderId:"OT-2"}},
    {metadata:{...f.metadata,extra:true}},
    {now:f.now+48*3600000}
  ];
  for(const variant of invalid)
    assert.throws(()=>check(f,variant),/external attestation:/);
});
test("expiry, invalid time, long validity and non-Ed25519 keys fail closed",()=>{
  const f=fixture();
  for(const patch of [
    {validFrom:"2026-02-30T00:00:00Z"},
    {validFrom:"2026-01-01T00:00:00+00:00"},
    {validUntil:utc(f.now+48*3600000)},
    {validUntil:utc(f.now-1000)}
  ])assert.throws(()=>check(f,{metadata:f.signed({...f.metadata,...patch,
    signature:undefined})}),/external attestation:/);
  const rsa=generateKeyPairSync("rsa",{modulusLength:2048}).publicKey.export({
    type:"spki",format:"pem"});
  assert.throws(()=>check(f,{publicKeyPem:rsa}),/external attestation:/);
});
function withFiles(fn){
  const dir=mkdtempSync(join(tmpdir(),"pia-signed-"));
  try{return fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}
}
function run(dir,f,additional=[]){
  const args=[cli,"--internal",join(dir,"internal.json"),
    "--links",join(dir,"links.json"),"--external",join(dir,"external.json"),
    "--currency","ARS","--scale","2","--expected-order","OT-1",
    "--expected-provider","sandbox",
    "--external-attestation",join(dir,"attestation.json"),
    "--provider-public-key",join(dir,"key.pem"),
    "--trusted-key-sha256",f.fingerprint,...additional];
  return spawnSync(process.execPath,args,{encoding:"utf8",timeout:10000});
}
function prepare(dir,f){
  writeFileSync(join(dir,"internal.json"),JSON.stringify([payment]));
  writeFileSync(join(dir,"links.json"),JSON.stringify([link]));
  writeFileSync(join(dir,"external.json"),f.bytes);
  writeFileSync(join(dir,"attestation.json"),JSON.stringify(f.metadata));
  writeFileSync(join(dir,"key.pem"),f.pem);
}
test("actual CLI signed path accepts only pinned intact snapshot and retains unverified comparison",()=>{
  withFiles(dir=>{
    const f=fixture();prepare(dir,f);
    const loaded=loadStatementArrayWithDigest(join(dir,"external.json"),"external");
    assert.equal(loaded.sha256,f.metadata.statementSha256);
    assert.deepEqual(loaded.data,[capture]);
    assert.deepEqual(loadStatementObject(join(dir,"attestation.json"),"attestation"),f.metadata);
    const good=run(dir,f);
    assert.equal(good.status,0,good.stderr);
    const result=JSON.parse(good.stdout);
    assert.equal(result.rows[0].classification,"amounts_agree_unverified");
    assert.equal(result.independentlyAuthenticated,false);
    assert.equal(result.externalStatementSignature.integrityVerified,true);
    assert.equal(result.externalStatementSignature.settlementVerified,false);
    assert.equal(run(dir,f).status,0,"replay is possible, never falsely claim protection");
    writeFileSync(join(dir,"external.json"),JSON.stringify([{...capture,amount:"9.30"}]));
    const tampered=run(dir,f);
    assert.equal(tampered.status,1,tampered.stderr);
    assert.equal(tampered.stdout,"");
    assert.match(tampered.stderr,/external attestation/);
  });
});
test("CLI rejects missing trust flag, invalid pin, ambiguous attestation, expired signature without stdout",()=>{
  withFiles(dir=>{
    const f=fixture();prepare(dir,f);
    const partial=run(dir,f,["--trusted-key-sha256","f".repeat(64)]);
    assert.equal(partial.status,1);
    assert.equal(partial.stdout,"");
    const expired={...f.metadata,validUntil:"2020-01-01T00:00:00Z"};
    writeFileSync(join(dir,"attestation.json"),JSON.stringify(expired));
    const bad=run(dir,f);
    assert.equal(bad.status,1);
    assert.equal(bad.stdout,"");
    writeFileSync(join(dir,"attestation.json"),
      JSON.stringify(f.metadata).replace('"scale":2','"scale":2,"scale":3'));
    const ambiguous=run(dir,f);
    assert.equal(ambiguous.status,1);
    assert.match(ambiguous.stderr,/duplicate JSON object member/);
    assert.equal(ambiguous.stdout,"");
  });
});

test("operator provider scope is mandatory and rejects a valid other-provider signature",()=>{
  withFiles(dir=>{
    const f=fixture();prepare(dir,f);
    const without=run(dir,f);
    assert.equal(without.status,0,without.stderr);
    const args=[cli,"--internal",join(dir,"internal.json"),
      "--links",join(dir,"links.json"),"--external",join(dir,"external.json"),
      "--currency","ARS","--scale","2","--expected-order","OT-1",
      "--external-attestation",join(dir,"attestation.json"),
      "--provider-public-key",join(dir,"key.pem"),
      "--trusted-key-sha256",f.fingerprint];
    const missing=spawnSync(process.execPath,args,{encoding:"utf8",timeout:10000});
    assert.equal(missing.status,1);
    assert.equal(missing.stdout,"");
    assert.match(missing.stderr,/--expected-provider/);
    const alternate={...f.metadata,providerId:"other"};
    writeFileSync(join(dir,"external.json"),JSON.stringify([{...capture,providerId:"other"}]));
    const bytes=JSON.stringify([{...capture,providerId:"other"}]);
    writeFileSync(join(dir,"attestation.json"),JSON.stringify(f.signed({
      ...alternate,statementSha256:createHash("sha256").update(bytes).digest("hex"),
      signature:undefined
    })));
    const wrong=run(dir,f);
    assert.equal(wrong.status,1,wrong.stderr);
    assert.equal(wrong.stdout,"");
    assert.match(wrong.stderr,/external attestation/);
  });
});

test("pinned public key descriptor rejects symlink, inode swap, growth and invalid UTF-8",()=>{
  withFiles(dir=>{
    const f=fixture();const key=join(dir,"key.pem"),other=join(dir,"other.pem");
    writeFileSync(key,f.pem);
    writeFileSync(other,f.pem);
    assert.equal(readPinnedPublicKey(key),f.pem);
    const alias=join(dir,"alias.pem");symlinkSync(key,alias);
    assert.throws(()=>readPinnedPublicKey(alias),/external attestation/);
    const swapIO={lstatSync:path=>lstatSync(path),
      openSync:()=>openSync(other,"r"),fstatSync,readSync,closeSync};
    assert.throws(()=>readPinnedPublicKey(key,swapIO),/external attestation/);
    const growingIO={lstatSync,openSync,closeSync,readSync,
      fstatSync:fd=>{const stat=fstatSync(fd);
        return {...stat,size:stat.size+1};}};
    assert.throws(()=>readPinnedPublicKey(key,growingIO),/external attestation/);
    writeFileSync(key,Buffer.from([0xff,0xfe]));
    assert.throws(()=>readPinnedPublicKey(key),/external attestation/);
  });
});
