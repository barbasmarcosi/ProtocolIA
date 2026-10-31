import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {verifyProviderEnvelope,parseSandboxProviderKeys} from "../../packages/adapters/nest/templates/ProviderWebhookVerifier.ts";

const secret=Buffer.alloc(32,0x11);
const rawBody=Buffer.from('{"provider":"sandbox","amount":"1.00","event":"settled"}');
const timestamp="1793440000",eventId="evt_12345678",keyId="sandbox_1";
const signature="v2=71033dfd23bc965cc8d17125539d8394d58e796bbb9deb7ea5a2c99f51732f6d";
const payloadSha256="20ece580daf2c31f7706a02043618938a28ea1fdf4041fabab1fc2f9558259eb";
const baseline={purpose:"inbox",keyId,timestamp,eventId,signature,rawBody,keys:{sandbox_1:secret},nowSeconds:1793440000};
const verify=change=>verifyProviderEnvelope({...baseline,...change});
test("signed raw bytes match frozen cross-language HMAC-SHA256 fixture",()=>{
  const mac=createHmac("sha256",secret)
    .update("protocolia-provider-proof-v2\ninbox\n"+keyId+"\n"+timestamp+"\n"+eventId+"\n")
    .update(rawBody).digest("hex");
  assert.equal("v2="+mac,signature);
  assert.deepEqual(verify({}),{keyId,eventId,payloadSha256});
  assert.deepEqual(verify({}),verify({}),"signature verification is stateless, NOT replay protection");
});
test("tampered raw bytes, event identity, key identity and signature fail closed",()=>{
  for(const change of [
    {rawBody:Buffer.from(rawBody.toString().replace("1.00","2.00"))},
    {rawBody:Buffer.from(rawBody.toString()+" ")},
    {eventId:"evt_99999999"},
    {keyId:"sandbox_2"},
    {signature:"v2="+signature.slice(3).replace(/^./,"f")},
    {signature:signature.toUpperCase()},
    {signature:"v1="+signature.slice(3)},
    {signature:signature.slice(0,-1)},
    {signature:"v2="+"0".repeat(64)}
  ])assert.equal(verify(change),null,JSON.stringify({...change,rawBody:undefined}));
});
test("strict timestamp window, no milliseconds, no newline or ambiguous identifiers",()=>{
  for(const change of [
    {nowSeconds:1793440301},{nowSeconds:1793439699},
    {nowSeconds:-1},{nowSeconds:1.5},
    {timestamp:"1793440000000"},{timestamp:"01793440000"},
    {timestamp:"1793440000\n"},{eventId:"evt_bad\nline"},
    {eventId:"evt_12345678\n"},{keyId:"sandbox_1\n"},
    {signature:signature+"\n"},
    {eventId:"short"},{keyId:"bad\nheader"},
    {keyId:"../sandbox_1"},{purpose:"wrong"},{purpose:"receipt-candidate"},{purpose:"lifecycle-observation"},{purpose:null}
  ])assert.equal(verify(change),null);
  assert.ok(verify({nowSeconds:1793440300}));
  assert.ok(verify({nowSeconds:1793439700}));
});
test("bounded body, exact key material, known key and bounded rotation",()=>{
  for(const change of [
    {rawBody:Buffer.alloc(0)},{rawBody:Buffer.alloc(65537)},
    {keys:{}},{keys:{sandbox_1:Buffer.alloc(31)}},
    {keys:{sandbox_1:Buffer.alloc(33)}},
    {keys:{sandbox_2:secret}},
    {keys:{sandbox_1:secret,a:secret,b:secret,c:secret}},
    {keys:{sandbox_1:secret,"invalid!":secret}}
  ])assert.equal(verify(change),null);
  assert.deepEqual(verify({keys:{sandbox_1:secret,retired_1:Buffer.alloc(32,0x22)}}),
    {keyId,eventId,payloadSha256});
});
test("verification does not parse payload semantics or claim settlement",()=>{
  assert.equal(typeof verify({})?.payloadSha256,"string");
  // Even an identical second delivery authenticates: PostgreSQL must dedupe it.
  assert.ok(verify({}));
  assert.ok(verify({}));
});

test("v2 purpose binding rejects signed bytes on the wrong endpoint",()=>{
  for(const purpose of ["inbox","receipt-candidate","lifecycle-observation"]){
    const sig="v2="+createHmac("sha256",secret)
      .update("protocolia-provider-proof-v2\n"+purpose+"\n"+keyId+"\n"+timestamp+"\n"+eventId+"\n")
      .update(rawBody).digest("hex");
    assert.ok(verify({purpose,signature:sig}));
    for(const other of ["inbox","receipt-candidate","lifecycle-observation"].filter(x=>x!==purpose))
      assert.equal(verify({purpose:other,signature:sig}),null,purpose+" -> "+other);
  }
});

test("server keyring rotates without fallback, and revokes removed key IDs",()=>{
  const one="11".repeat(32),two="22".repeat(32),three="33".repeat(32);
  const legacy=parseSandboxProviderKeys(one,undefined);
  assert.deepEqual(Object.keys(legacy),["sandbox_1"]);
  assert.ok(verify({keys:legacy}));
  const rotated=parseSandboxProviderKeys("",`sandbox_1=${one},sandbox_2=${two}`);
  assert.deepEqual(Object.keys(rotated).sort(),["sandbox_1","sandbox_2"]);
  assert.ok(verify({keys:rotated}));
  const revoked=parseSandboxProviderKeys("",`sandbox_2=${two}`);
  assert.equal(verify({keys:revoked}),null,"removed key ID cannot authenticate");
  const newSignature="v2="+createHmac("sha256",Buffer.from(two,"hex"))
    .update("protocolia-provider-proof-v2\ninbox\nsandbox_2\n"+timestamp+"\n"+eventId+"\n")
    .update(rawBody).digest("hex");
  assert.ok(verify({keyId:"sandbox_2",signature:newSignature,keys:rotated}));
  assert.ok(verify({keyId:"sandbox_2",signature:newSignature,keys:revoked}));
  assert.equal(verify({keyId:"sandbox_2",signature:newSignature,keys:legacy}),null);
  for(const [old,ring] of [
    ["",""],[one,`sandbox_2=${two}`],["BAD",""],
    ["",`sandbox_1=${one},sandbox_1=${two}`],
    ["",`sandbox_1=${one},sandbox_2=${one}`],
    ["",`sandbox_1=${one},`],
    ["",`sandbox_1=${one},sandbox_2=${two},sandbox_3=${three},sandbox_4=${one}`],
    ["",`sandbox_1=${"aa".repeat(32).toUpperCase()}`],
    ["",`sandbox_1=${one} `],["",`sandbox_1=${one}\n`],
    ["",`__proto__=${one},__proto__=${two}`]
  ])assert.equal(parseSandboxProviderKeys(old,ring),null);
});
