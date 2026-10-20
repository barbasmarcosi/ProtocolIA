// BFF AES-256-GCM keyring. New writes use the active key; up to 3 retired
// keys remain decryption-only through a bounded rotation window.
import {createCipheriv,createDecipheriv,createHash,randomBytes} from "node:crypto";
type Key={tag:string;key:Buffer};
const parse=(raw:string):Key=>{
  if(!/^[a-fA-F0-9]{64}$/.test(raw))throw Error("BFF keys must contain 32 hex bytes");
  const key=Buffer.from(raw,"hex");
  return {key,tag:createHash("sha256").update(key).digest("hex").slice(0,16)};
};
export function createBffKeyring(activeHex:string,retiredList=""){
  const retired=retiredList.trim()?
    retiredList.split(",").map(x=>parse(x.trim())):[];
  if(retired.length>3)throw Error("BFF keyring accepts at most three retired keys");
  const active=parse(activeHex);
  const keys=[active,...retired];
  if(new Set(keys.map(k=>k.tag)).size!==keys.length)
    throw Error("BFF keyring contains duplicate keys");
  const decryptWith=(key:Key,data:Buffer)=>{
    if(data.length<29||data.length>20000)throw Error("Invalid BFF ciphertext length");
    const decipher=createDecipheriv("aes-256-gcm",key.key,data.subarray(0,12));
    decipher.setAuthTag(data.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString("utf8"));
  };
  return {
    tag:active.tag,
    seal(value:unknown){
      const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",active.key,iv);
      const bytes=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
      return "v1:"+active.tag+":"+
        Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString("base64url");
    },
    open(encoded:string):any{
      if(typeof encoded!=="string"||encoded.length>28000)throw Error("Invalid BFF payload");
      if(encoded.startsWith("v1:")){
        const match=/^v1:([a-f0-9]{16}):([A-Za-z0-9_-]+)$/.exec(encoded);
        if(!match)throw Error("Invalid BFF envelope");
        const candidate=keys.find(k=>k.tag===match[1]);
        if(!candidate)throw Error("Unknown BFF key");
        return decryptWith(candidate,Buffer.from(match[2],"base64url"));
      }
      // Upgrade path: sessions minted before S1d.2j carry no key identifier.
      if(!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error("Invalid legacy BFF payload");
      const raw=Buffer.from(encoded,"base64url");
      for(const candidate of keys){
        try{return decryptWith(candidate,raw);}catch{}
      }
      throw Error("Unable to decrypt legacy BFF payload");
    }
  };
}
