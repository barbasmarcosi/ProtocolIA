import test from "node:test";
import assert from "node:assert/strict";
import {createCipheriv,randomBytes} from "node:crypto";
import {createBffKeyring} from "../../packages/adapters/nest/templates/BffKeyring.ts";
const a=randomBytes(32).toString("hex"),b=randomBytes(32).toString("hex"),c=randomBytes(32).toString("hex");
test("versioned AES keyring rotates and retained keys decrypt but never encrypt",()=>{
  const old=createBffKeyring(a),newRing=createBffKeyring(b,a);
  const oldPayload=old.seal({access:"private",csrf:"nonce"});
  assert.match(oldPayload,/^v1:[a-f0-9]{16}:[A-Za-z0-9_-]+$/);
  assert.deepEqual(newRing.open(oldPayload),{access:"private",csrf:"nonce"});
  assert.notEqual(newRing.tag,old.tag);
  assert.match(newRing.seal({hello:"new"}),new RegExp("^v1:"+newRing.tag+":"));
  assert.throws(()=>createBffKeyring(b).open(oldPayload),/Unknown BFF key/);
  assert.deepEqual(createBffKeyring(b).open(newRing.seal({hello:"new"})),{hello:"new"});
});
test("legacy unversioned AES session is readable during retirement window",()=>{
  const old=createBffKeyring(a),iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",Buffer.from(a,"hex"),iv);
  const body=Buffer.concat([cipher.update(JSON.stringify({value:42})),cipher.final()]);
  const legacy=Buffer.concat([iv,cipher.getAuthTag(),body]).toString("base64url");
  assert.deepEqual(createBffKeyring(b,a).open(legacy),{value:42});
  assert.throws(()=>createBffKeyring(b).open(legacy),/Unable to decrypt/);
});
test("unknown or forged key tags and tampered ciphertext fail closed",()=>{
  const payload=createBffKeyring(a).seal({v:1});
  assert.throws(()=>createBffKeyring(c).open(payload),/Unknown BFF key/);
  const parts=payload.split(":");
  assert.throws(()=>createBffKeyring(a).open("v1:"+c.slice(0,16)+":"+parts[2]),/Unknown BFF key/);
  assert.throws(()=>createBffKeyring(a).open(payload.replace(/.$/,"!")),/Invalid BFF envelope/);
  const bytes=Buffer.from(parts[2],"base64url");bytes[bytes.length-2]^=16;
  assert.throws(()=>createBffKeyring(a).open(parts[0]+":"+parts[1]+":"+bytes.toString("base64url")));
});
test("invalid and duplicated encryption keys are rejected at startup",()=>{
  assert.throws(()=>createBffKeyring("short"),/32 hex bytes/);
  assert.throws(()=>createBffKeyring(a,a),/duplicate/);
  assert.throws(()=>createBffKeyring(a,b+","+c+","+b),/duplicate/);
  assert.throws(()=>createBffKeyring(a,b+","+c+","+b+","+a),/at most three/);
  assert.throws(()=>createBffKeyring(a,b+", "),/32 hex bytes/);
});
