#!/usr/bin/env node
// Offline comparison; detached signature proves only integrity relative to a pinned key.
// Never treats the key as independently verified provider identity or bank settlement.
import {loadStatementArray,loadStatementArrayWithDigest,loadStatementObject} from "../../packages/adapters/provider-statement-input.mjs";
import {verifyDetachedStatement,readPinnedPublicKey} from "../../packages/adapters/provider-statement-signature.mjs";
import {consumeLocalSignedStatement} from "../../packages/adapters/provider-statement-local-replay.mjs";
import {consumeLocalSignedEvents} from "../../packages/adapters/provider-statement-event-replay.mjs";
import {reconcileProviderStatement} from "../../packages/adapters/provider-statement-reconciliation.mjs";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
try {
  const args=process.argv.slice(2);
  const flags=new Map();
  for(let i=0;i<args.length;i+=2) {
    if(!args[i]?.startsWith("--") || args[i+1]===undefined || flags.has(args[i]))
      throw Error("Duplicate, missing or malformed flag");
    flags.set(args[i],args[i+1]);
  }
  const keys=["--internal","--links","--external","--currency","--scale"];
  const optional=["--internal-returns","--expected-order","--expected-provider","--external-attestation",
    "--provider-public-key","--trusted-key-sha256","--local-replay-dir",
    "--local-event-replay-dir"];
  const signatureFlags=["--external-attestation","--provider-public-key","--trusted-key-sha256"];
  const supplied=signatureFlags.filter(flag=>flags.has(flag)).length;
  if((supplied!==0 && (supplied!==3 || !flags.has("--expected-order") ||
       !flags.has("--expected-provider"))) ||
     (supplied===0 && flags.has("--expected-provider")) ||
     ((flags.has("--local-replay-dir") || flags.has("--local-event-replay-dir")) && supplied!==3) ||
     (flags.has("--local-replay-dir") && flags.has("--local-event-replay-dir")) )
    throw Error("Detached signature requires all three trust flags, --expected-order and --expected-provider");
  if(flags.size<keys.length || flags.size>keys.length+optional.length ||
     keys.some(key=>!flags.has(key)) ||
     [...flags.keys()].some(key=>![...keys,...optional].includes(key)))
    throw Error("Usage: reconcile-provider-statement --internal receipts.json [--expected-order OT-1] [--internal-returns returns.json] --links map.json --external statement.json --currency ARS --scale 2");
  const rawScale=flags.get("--scale");
  if(!/^[0-6]$/.test(rawScale)) throw Error("Explicit scale 0..6 required");
  const internal=loadStatementArray(flags.get("--internal"),"internal");
  if(flags.has("--expected-order")) {
    const expected=flags.get("--expected-order");
    if(!ID.test(expected) || internal.length===0 ||
       internal.some(row=>row?.orderId!==expected))
      throw Error("internal: snapshot missing or outside expected order");
  }
  const external=loadStatementArrayWithDigest(flags.get("--external"),"external");
  const attestation=supplied===3 ?
    loadStatementObject(flags.get("--external-attestation"),"external attestation") : null;
  const signature=supplied===3 ? verifyDetachedStatement({
    metadata:attestation,
    statementSha256:external.sha256,external:external.data,
    expectedOrder:flags.get("--expected-order"),
    expectedProvider:flags.get("--expected-provider"),currency:flags.get("--currency"),
    scale:Number(rawScale),
    publicKeyPem:readPinnedPublicKey(flags.get("--provider-public-key")),
    trustedKeySha256:flags.get("--trusted-key-sha256")
  }) : null;
  const result=reconcileProviderStatement({
    internal,
    ...(flags.has("--internal-returns") ?
      {internalReturns:loadStatementArray(flags.get("--internal-returns"),"internalReturns")} : {}),
    links:loadStatementArray(flags.get("--links"),"links"),
    external:external.data,
    currency:flags.get("--currency"),scale:Number(rawScale)
  });
  if(signature) {
    if(flags.has("--local-replay-dir")) {
      const marker=consumeLocalSignedStatement({
        directory:flags.get("--local-replay-dir"),
        metadata:attestation
      });
      signature.replayProtection=marker.replayProtection;
      signature.localReplayMarkerSha256=marker.markerSha256;
    }
    if(flags.has("--local-event-replay-dir")) {
      const claim=consumeLocalSignedEvents({
        directory:flags.get("--local-event-replay-dir"),
        metadata:attestation,external:external.data
      });
      signature.replayProtection=claim.replayProtection;
      signature.consumedEventCount=claim.consumedEventCount;
    }
    result.externalStatementSignature=signature;
  }
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  process.exitCode=result.counts.exceptions ? 2 : 0;
} catch(error) {
  // Avoid logging contents of sensitive external statements on parse errors.
  process.stderr.write("RECONCILIATION_INPUT_REJECTED: "+String(error.message).slice(0,250)+"\n");
  process.exitCode=1;
}
