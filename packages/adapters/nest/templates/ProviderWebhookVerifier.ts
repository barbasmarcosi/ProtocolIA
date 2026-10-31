// S2c-1c0: provider-neutral *envelope* authentication only.
// No endpoint, settlement, replay storage or refund authority is granted here.
import {createHash,createHmac,timingSafeEqual} from "node:crypto";

export type ProviderEnvelope={
  keyId:string;
  timestamp:string; // canonical Unix seconds, not milliseconds
  eventId:string;
  signature:string; // v1=<lowercase 64-char hex HMAC-SHA256>
  rawBody:Uint8Array; // original HTTP bytes, NEVER reserialized JSON
  keys:Readonly<Record<string,Uint8Array>>; // trusted server-side keys, not HTTP data
  nowSeconds:number;
};
export type VerifiedProviderEnvelope=Readonly<{
  keyId:string;
  eventId:string;
  payloadSha256:string;
}>;

const prefix="protocolia-provider-proof-v1\n";
const keyIdPattern=/^[A-Za-z0-9_-]{1,32}$/;
const eventPattern=/^[A-Za-z0-9_-]{8,128}$/;
const secondsPattern=/^[1-9][0-9]{9}$/;
const signaturePattern=/^v1=[0-9a-f]{64}$/;

/** Rejects malformed/expired/unsigned bytes; never changes money or records events.
 * The caller MUST atomically deduplicate (provider,keyId,eventId) in PostgreSQL
 * before giving any business meaning to an authenticated event.
 */
export function verifyProviderEnvelope(input:ProviderEnvelope):VerifiedProviderEnvelope|null{
  if(!input||!keyIdPattern.test(input.keyId)||
    !eventPattern.test(input.eventId)||
    !secondsPattern.test(input.timestamp)||
    !signaturePattern.test(input.signature)||
    !(input.rawBody instanceof Uint8Array)||
    input.rawBody.byteLength<1||input.rawBody.byteLength>65536||
    !Number.isSafeInteger(input.nowSeconds)||input.nowSeconds<0||
    !input.keys||typeof input.keys!=="object"||Array.isArray(input.keys))
    return null;
  const keyIds=Object.keys(input.keys);
  if(keyIds.length<1||keyIds.length>3||!keyIds.every(x=>keyIdPattern.test(x))||
    !Object.hasOwn(input.keys,input.keyId))
    return null;
  const secret=input.keys[input.keyId];
  if(!(secret instanceof Uint8Array)||secret.byteLength!==32)return null;
  const seconds=Number(input.timestamp);
  if(!Number.isSafeInteger(seconds)||Math.abs(seconds-input.nowSeconds)>300)return null;
  const raw=Buffer.from(input.rawBody);
  const header=Buffer.from(prefix+input.keyId+"\n"+input.timestamp+"\n"+input.eventId+"\n","utf8");
  const expected=createHmac("sha256",Buffer.from(secret)).update(header).update(raw).digest();
  const received=Buffer.from(input.signature.slice(3),"hex");
  if(!timingSafeEqual(expected,received))return null;
  return Object.freeze({
    keyId:input.keyId,eventId:input.eventId,
    payloadSha256:createHash("sha256").update(raw).digest("hex")
  });
}
