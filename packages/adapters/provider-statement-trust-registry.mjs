// Optional operator-pinned, read-only provider/key enrollment gate.
// An enrolled key is not independent proof of the provider's legal identity.
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA=/^[0-9a-f]{64}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const fail=()=>{throw Error("provider trust registry: invalid, revoked, expired or mismatched binding");};
const exact=(o,fields)=>o!==null && typeof o==="object" && !Array.isArray(o) &&
  Object.keys(o).length===fields.length && fields.every(k=>Object.hasOwn(o,k));
function time(value) {
  if(typeof value!=="string" || !UTC.test(value))fail();
  const ms=Date.parse(value);
  if(!Number.isFinite(ms) || new Date(ms).toISOString()!==value.replace("Z",".000Z"))fail();
  return ms;
}
/**
 * Fail closed on the entire registry, not just the requested provider: a
 * duplicate provider/key or cross-provider key reuse is ambiguous authority.
 * The caller MUST independently pin SHA-256 of the exact registry file bytes,
 * and recheck its original file descriptor/snapshot before any replay write.
 */
export function verifyProviderTrustRegistry({registry,registrySha256,trustedRegistrySha256,
  expectedProvider,keyId,keyFingerprint,statementValidFrom,statementValidUntil,
  now=Date.now()}) {
  if(!SHA.test(registrySha256) || !SHA.test(trustedRegistrySha256) ||
     registrySha256!==trustedRegistrySha256 ||
     typeof expectedProvider!=="string" || !ID.test(expectedProvider) ||
     typeof keyId!=="string" || !ID.test(keyId) || !SHA.test(keyFingerprint) ||
     !exact(registry,["version","providers"]) || registry.version!==1 ||
     !Array.isArray(registry.providers) || registry.providers.length<1 ||
     registry.providers.length>32 || !Number.isFinite(now))fail();
  const signedFrom=time(statementValidFrom),signedUntil=time(statementValidUntil);
  if(signedUntil<=signedFrom)fail();
  const providers=new Set(),globalKeys=new Set();
  let selected;
  for(const provider of registry.providers) {
    if(!exact(provider,["providerId","keys"]) ||
       typeof provider.providerId!=="string" || !ID.test(provider.providerId) ||
       providers.has(provider.providerId) || !Array.isArray(provider.keys) ||
       provider.keys.length<1 || provider.keys.length>32)fail();
    providers.add(provider.providerId);
    const ids=new Set(),fingerprints=new Set();
    for(const entry of provider.keys) {
      if(!exact(entry,["keyId","spkiSha256","status","validFrom","validUntil"]) ||
         typeof entry.keyId!=="string" || !ID.test(entry.keyId) ||
         !SHA.test(entry.spkiSha256) ||
         !["active","revoked"].includes(entry.status) ||
         ids.has(entry.keyId) || fingerprints.has(entry.spkiSha256) ||
         globalKeys.has(entry.spkiSha256))fail();
      ids.add(entry.keyId);fingerprints.add(entry.spkiSha256);
      globalKeys.add(entry.spkiSha256);
      const from=time(entry.validFrom),until=time(entry.validUntil);
      if(until<=from)fail();
      if(provider.providerId===expectedProvider && entry.keyId===keyId) {
        if(entry.status!=="active" || entry.spkiSha256!==keyFingerprint ||
           signedFrom<from || signedUntil>until || now<from || now>until)fail();
        selected=entry;
      }
    }
  }
  if(!selected)fail();
  return {providerId:expectedProvider,keyId,
    keyFingerprint,registrySha256,
    trustScope:"operator_pinned_registry_only",
    providerIdentityVerified:false,settlementVerified:false};
}
