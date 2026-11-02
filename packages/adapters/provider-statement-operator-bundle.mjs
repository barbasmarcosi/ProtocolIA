// Optional independent OPERATOR-signed binding of an offline comparison's
// exact input bytes. This does not authenticate the provider or bank clearing.
// Provider statement signatures are a separate trust boundary.
import {createHash,createPublicKey,verify} from "node:crypto";

const HEX=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const FIELDS=["version","orderId","currency","scale","internalSha256",
  "internalReturnsSha256","linksSha256","externalSha256",
  "validFrom","validUntil","signature"];
const exact=(obj,keys)=>obj!==null && typeof obj==="object" &&
  !Array.isArray(obj) && Object.keys(obj).length===keys.length &&
  keys.every(k=>Object.hasOwn(obj,k));
const reject=()=>{throw Error("operator bundle: invalid, expired or mismatched signed snapshot");};
function parsedTime(value) {
  if(typeof value!=="string" || !UTC.test(value))reject();
  const time=Date.parse(value);
  if(!Number.isFinite(time) ||
     new Date(time).toISOString()!==value.replace("Z",".000Z"))reject();
  return time;
}
// Domain-separated message; every value is strictly bounded and cannot
// contain a newline, including null's unique sentinel for an omitted journal.
export function operatorSnapshotMessage(meta) {
  return Buffer.from(["ProtocolIA-S2C-operator-bundle-Ed25519-v1",
    meta.version,meta.orderId,meta.currency,meta.scale,
    meta.internalSha256,meta.internalReturnsSha256??"ABSENT",
    meta.linksSha256,meta.externalSha256,
    meta.validFrom,meta.validUntil,""].join("\n"),"utf8");
}
export function verifyOperatorSnapshotBundle({
  metadata,snapshots,expectedOrder,currency,scale,
  publicKeyPem,trustedKeySha256,now=Date.now()
}) {
  if(!exact(metadata,FIELDS) || metadata.version!==1 ||
    typeof expectedOrder!=="string" || !ID.test(expectedOrder) ||
    metadata.orderId!==expectedOrder ||
    typeof currency!=="string" || !/^[A-Z]{3}$/.test(currency) ||
    !Number.isInteger(scale) || scale<0 || scale>6 ||
    metadata.currency!==currency || metadata.scale!==scale ||
    !HEX.test(trustedKeySha256) || !snapshots ||
    typeof snapshots!=="object" || Array.isArray(snapshots) ||
    Object.keys(snapshots).length!==4 ||
    !["internal","internalReturns","links","external"].every(x=>Object.hasOwn(snapshots,x)) ||
    !HEX.test(snapshots.internal) || !HEX.test(snapshots.links) ||
    !HEX.test(snapshots.external) ||
    (snapshots.internalReturns!==null && !HEX.test(snapshots.internalReturns)) ||
    metadata.internalSha256!==snapshots.internal ||
    metadata.internalReturnsSha256!==snapshots.internalReturns ||
    metadata.linksSha256!==snapshots.links ||
    metadata.externalSha256!==snapshots.external)reject();
  const from=parsedTime(metadata.validFrom),until=parsedTime(metadata.validUntil);
  if(until<=from || until-from>24*60*60*1000 ||
     !Number.isFinite(now) || now<from || now>until)reject();
  if(typeof publicKeyPem!=="string" || publicKeyPem.length>8192 ||
     !/^-----BEGIN PUBLIC KEY-----\r?\n/.test(publicKeyPem))reject();
  let key,der;
  try {
    key=createPublicKey(publicKeyPem);
    if(key.asymmetricKeyType!=="ed25519")reject();
    der=key.export({type:"spki",format:"der"});
  }catch{reject();}
  const fingerprint=createHash("sha256").update(der).digest("hex");
  if(fingerprint!==trustedKeySha256 ||
     typeof metadata.signature!=="string" ||
     !/^[A-Za-z0-9+/]{86}==$/.test(metadata.signature))reject();
  const signature=Buffer.from(metadata.signature,"base64");
  if(signature.length!==64 ||
     signature.toString("base64")!==metadata.signature ||
     !verify(null,operatorSnapshotMessage(metadata),key,signature))reject();
  return {
    exactInputBytesBound:true,
    operatorKeyFingerprint:fingerprint,
    validUntil:metadata.validUntil,
    providerIdentityVerified:false,
    settlementVerified:false
  };
}
