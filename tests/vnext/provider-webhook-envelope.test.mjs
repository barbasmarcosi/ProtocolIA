import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {verifyProviderEnvelope} from "../../packages/adapters/nest/templates/ProviderWebhookVerifier.ts";

const secret=Buffer.alloc(32,0x11);
const rawBody=Buffer.from('{"provider":"sandbox","amount":"1.00","event":"settled"}');
const timestamp="1793440000",eventId="evt_12345678",keyId="sandbox_1";
const signature="v1=12eb6b3aca418544295012e183c6401db154e9c536b85470a2c37145927eabdb";
const payloadSha256="20ece580daf2c31f7706a02043618938a28ea1fdf4041fabab1fc2f9558259eb";
const baseline={keyId,timestamp,eventId,signature,rawBody,keys:{sandbox_1:secret},nowSeconds:1793440000};
const verify=change=>verifyProviderEnvelope({...baseline,...change});
test("signed raw bytes match frozen cross-language HMAC-SHA256 fixture",()=>{
  const mac=createHmac("sha256",secret)
    .update("protocolia-provider-proof-v1\n"+keyId+"\n"+timestamp+"\n"+eventId+"\n")
    .update(rawBody).digest("hex");
  assert.equal("v1="+mac,signature);
  assert.deepEqual(verify({}),{keyId,eventId,payloadSha256});
  assert.deepEqual(verify({}),verify({}),"signature verification is stateless, NOT replay protection");
});
test("tampered raw bytes, event identity, key identity and signature fail closed",()=>{
  for(const change of [
    {rawBody:Buffer.from(rawBody.toString().replace("1.00","2.00"))},
    {rawBody:Buffer.from(rawBody.toString()+" ")},
    {eventId:"evt_99999999"},
    {keyId:"sandbox_2"},
    {signature:"v1="+signature.slice(3).replace(/^./,"f")},
    {signature:signature.toUpperCase()},
    {signature:"v2="+signature.slice(3)},
    {signature:signature.slice(0,-1)},
    {signature:"v1="+"0".repeat(64)}
  ])assert.equal(verify(change),null,JSON.stringify({...change,rawBody:undefined}));
});
test("strict timestamp window, no milliseconds, no newline or ambiguous identifiers",()=>{
  for(const change of [
    {nowSeconds:1793440301},{nowSeconds:1793439699},
    {nowSeconds:-1},{nowSeconds:1.5},
    {timestamp:"1793440000000"},{timestamp:"01793440000"},
    {timestamp:"1793440000\n"},{eventId:"evt_bad\nline"},
    {eventId:"short"},{keyId:"bad\nheader"},
    {keyId:"../sandbox_1"}
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
