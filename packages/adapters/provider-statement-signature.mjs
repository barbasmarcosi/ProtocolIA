// Offline integrity gate for a detached, operator-pinned Ed25519 statement.
// A valid signature authenticates bytes relative to the supplied public key,
// NOT the provider's legal identity, bank clearing, or replay uniqueness.
import {createHash,createPublicKey,verify} from "node:crypto";
import {readFileSync,lstatSync} from "node:fs";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX=/^[0-9a-f]{64}$/;
const UTC=/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/;
const FIELDS=["version","providerId","keyId","orderId","currency","scale",
  "statementSha256","validFrom","validUntil","signature"];
const exact=(value,keys)=>value!==null && typeof value==="object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("|")===keys.slice().sort().join("|");
function fail(){throw Error("external attestation: invalid, untrusted, expired or mismatched");}
function time(value) {
  if(typeof value!=="string" || !UTC.test(value))fail();
  const millis=Date.parse(value);
  if(!Number.isFinite(millis) || new Date(millis).toISOString()!==value.replace("Z",".000Z"))fail();
  return millis;
}
export function signedStatementMessage(meta) {
  return Buffer.from(["ProtocolIA-S2C-Ed25519-v1",meta.version,meta.providerId,
    meta.keyId,meta.orderId,meta.currency,meta.scale,meta.statementSha256,
    meta.validFrom,meta.validUntil,""].join("\\n"),"utf8");
}
export function verifyDetachedStatement({metadata,statementSha256,external,
  expectedOrder,currency,scale,publicKeyPem,trustedKeySha256,now=Date.now()}) {
  if(!exact(metadata,FIELDS) || metadata.version!==1 ||
     typeof metadata.providerId!=="string" || !ID.test(metadata.providerId) ||
     typeof metadata.keyId!=="string" || !ID.test(metadata.keyId) ||
     typeof expectedOrder!=="string" || !ID.test(expectedOrder) ||
     metadata.orderId!==expectedOrder || metadata.currency!==currency ||
     metadata.scale!==scale || !HEX.test(statementSha256) ||
     metadata.statementSha256!==statementSha256 ||
     !HEX.test(trustedKeySha256) || !Array.isArray(external) ||
     external.some(row=>row?.providerId!==metadata.providerId))fail();
  const from=time(metadata.validFrom),until=time(metadata.validUntil);
  if(until<=from || until-from>24*60*60*1000 ||
     !Number.isFinite(now) || now<from || now>until)fail();
  if(typeof publicKeyPem!=="string" || publicKeyPem.length>8192 ||
     !/^-----BEGIN PUBLIC KEY-----\\r?\\n/.test(publicKeyPem))fail();
  let key,der;
  try {
    key=createPublicKey(publicKeyPem);
    if(key.asymmetricKeyType!=="ed25519")fail();
    der=key.export({type:"spki",format:"der"});
  }catch{fail();}
  const fingerprint=createHash("sha256").update(der).digest("hex");
  if(fingerprint!==trustedKeySha256 ||
     typeof metadata.signature!=="string" ||
     !/^[A-Za-z0-9+/]{86}==$/.test(metadata.signature))fail();
  const signature=Buffer.from(metadata.signature,"base64");
  if(signature.length!==64 ||
     signature.toString("base64")!==metadata.signature ||
     !verify(null,signedStatementMessage(metadata),key,signature))fail();
  return {integrityVerified:true,providerIdentityVerified:false,
    settlementVerified:false,replayProtection:"none_offline",
    providerId:metadata.providerId,keyId:metadata.keyId,
    keyFingerprint:fingerprint,statementSha256,validUntil:metadata.validUntil};
}
export function readPinnedPublicKey(file) {
  // The out-of-band SHA-256 pin is mandatory; a path alone is never trusted.
  try {
    const stat=lstatSync(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size>8192)fail();
    return readFileSync(file,"utf8");
  }catch{fail();}
}
