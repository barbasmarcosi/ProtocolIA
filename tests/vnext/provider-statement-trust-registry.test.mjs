import test from "node:test";
import assert from "node:assert/strict";
import {verifyProviderTrustRegistry} from "../../packages/adapters/provider-statement-trust-registry.mjs";
const a="a".repeat(64),b="b".repeat(64),c="c".repeat(64);
const key={keyId:"K1",spkiSha256:a,status:"active",
  validFrom:"2026-01-01T00:00:00Z",validUntil:"2027-01-01T00:00:00Z"};
const registry={version:1,providers:[{providerId:"sandbox",keys:[key]}]};
const input={registry,registrySha256:b,trustedRegistrySha256:b,
  expectedProvider:"sandbox",keyId:"K1",keyFingerprint:a,
  statementValidFrom:"2026-11-02T04:00:00Z",statementValidUntil:"2026-11-02T05:00:00Z",
  now:Date.parse("2026-11-02T04:30:00Z")};
const clone=()=>structuredClone(registry);
const denied=(overrides)=>assert.throws(()=>verifyProviderTrustRegistry({...input,...overrides}),
  /provider trust registry/);
test("pinned enrollment matches provider, key id, fingerprint and full signed validity",()=>{
  const result=verifyProviderTrustRegistry(input);
  assert.equal(result.trustScope,"operator_pinned_registry_only");
  assert.equal(result.providerIdentityVerified,false);
  assert.equal(result.settlementVerified,false);
  assert.equal(result.keyFingerprint,a);
});
test("registry byte pin and selected signer binding fail closed",()=>{
  denied({trustedRegistrySha256:c});
  denied({trustedRegistrySha256:"A".repeat(64)});
  denied({expectedProvider:"unknown"});
  denied({keyId:"K2"});
  denied({keyFingerprint:c});
  denied({statementValidUntil:"2027-02-01T00:00:00Z"});
  denied({now:Date.parse("2027-02-01T00:00:00Z")});
  denied({statementValidFrom:"not-time"});
});
test("revocation, duplicate identities and malformed unrelated providers reject entire registry",()=>{
  const revoked=clone();revoked.providers[0].keys[0].status="revoked";
  denied({registry:revoked});
  const duplicateProvider=clone();duplicateProvider.providers.push(structuredClone(duplicateProvider.providers[0]));
  denied({registry:duplicateProvider});
  const duplicateKey=clone();duplicateKey.providers[0].keys.push({...key});
  denied({registry:duplicateKey});
  const alias=clone();alias.providers.push({providerId:"other",keys:[{...key,keyId:"K2"}]});
  denied({registry:alias});
  const malformed=clone();malformed.providers.push({providerId:"other",keys:[{...key,keyId:"K2",spkiSha256:c,unexpected:1}]});
  denied({registry:malformed});
  const invalidWindow=clone();invalidWindow.providers[0].keys[0].validUntil=key.validFrom;
  denied({registry:invalidWindow});
  denied({registry:{...registry,unexpected:1}});
  denied({registry:{version:1,providers:[]}});
});
