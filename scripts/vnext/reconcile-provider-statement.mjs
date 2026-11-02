#!/usr/bin/env node
// Offline comparison; detached signature proves only integrity relative to a pinned key.
// Never treats the key as independently verified provider identity or bank settlement.
import {loadStatementArrayWithDigest,loadStatementObjectWithDigest,
  assertStatementSnapshotsUnchanged} from "../../packages/adapters/provider-statement-input.mjs";
import {verifyDetachedStatement,readPinnedPublicKey} from "../../packages/adapters/provider-statement-signature.mjs";
import {consumeLocalSignedStatement} from "../../packages/adapters/provider-statement-local-replay.mjs";
import {consumeLocalSignedEvents} from "../../packages/adapters/provider-statement-event-replay.mjs";
import {reconcileProviderStatement} from "../../packages/adapters/provider-statement-reconciliation.mjs";
import {verifyOperatorSnapshotBundle} from "../../packages/adapters/provider-statement-operator-bundle.mjs";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
try {
  const args=process.argv.slice(2);
  const flags=new Map();
  for(let i=0;i<args.length;i+=2) {
    if(!args[i]?.startsWith("--") || args[i+1]===undefined || flags.has(args[i]))
      throw Error("Duplicate, missing or malformed flag");
    flags.set(args[i],args[i+1]);
  }
  const keys=["--internal","--links","--external","--currency","--scale","--expected-order"];
  const optional=["--internal-returns","--expected-provider","--external-attestation",
    "--provider-public-key","--trusted-key-sha256","--local-replay-dir",
    "--local-event-replay-dir","--operator-bundle-manifest",
    "--operator-public-key","--trusted-operator-key-sha256"];
  const signatureFlags=["--external-attestation","--provider-public-key","--trusted-key-sha256"];
  const supplied=signatureFlags.filter(flag=>flags.has(flag)).length;
  const bundleFlags=["--operator-bundle-manifest","--operator-public-key",
    "--trusted-operator-key-sha256"];
  const bundleSupplied=bundleFlags.filter(flag=>flags.has(flag)).length;
  if(bundleSupplied!==0 && bundleSupplied!==3)
    throw Error("Operator bundle requires all three trust flags");
  if((supplied!==0 && (supplied!==3 || !flags.has("--expected-order") ||
       !flags.has("--expected-provider"))) ||
     (supplied===0 && flags.has("--expected-provider")) ||
     ((flags.has("--local-replay-dir") || flags.has("--local-event-replay-dir")) && supplied!==3) ||
     (flags.has("--local-replay-dir") && flags.has("--local-event-replay-dir")) )
    throw Error("Detached signature requires all three trust flags, --expected-order and --expected-provider");
  if(flags.size<keys.length || flags.size>keys.length+optional.length ||
     keys.some(key=>!flags.has(key)) ||
     [...flags.keys()].some(key=>![...keys,...optional].includes(key)))
    throw Error("Usage: reconcile-provider-statement --internal receipts.json --expected-order OT-1 [--internal-returns returns.json] --links map.json --external statement.json --currency ARS --scale 2");
  const rawScale=flags.get("--scale");
  if(!/^[0-6]$/.test(rawScale)) throw Error("Explicit scale 0..6 required");
  const snapshots=[];
  const readSource=(flag,name,object=false)=>{
    const file=flags.get(flag);
    const snapshot=object
      ? loadStatementObjectWithDigest(file,name)
      : loadStatementArrayWithDigest(file,name);
    snapshots.push({file,name,sha256:snapshot.sha256,identity:snapshot.identity});
    return snapshot;
  };
  const internalSnapshot=readSource("--internal","internal");
  const internal=internalSnapshot.data;
  const expected=flags.get("--expected-order");
  if(!ID.test(expected) || internal.length===0 ||
     internal.some(row=>row?.orderId!==expected))
    throw Error("internal: snapshot missing or outside expected order");
  const external=readSource("--external","external");
  const attestation=supplied===3 ?
    readSource("--external-attestation","external attestation",true).data : null;
  const signature=supplied===3 ? verifyDetachedStatement({
    metadata:attestation,
    statementSha256:external.sha256,external:external.data,
    expectedOrder:flags.get("--expected-order"),
    expectedProvider:flags.get("--expected-provider"),currency:flags.get("--currency"),
    scale:Number(rawScale),
    publicKeyPem:readPinnedPublicKey(flags.get("--provider-public-key")),
    trustedKeySha256:flags.get("--trusted-key-sha256")
  }) : null;
  const linksSnapshot=readSource("--links","links");
  const links=linksSnapshot.data;
  const returnsSnapshot=flags.has("--internal-returns")
    ? readSource("--internal-returns","internalReturns") : null;
  const internalReturns=returnsSnapshot?.data;
  const result=reconcileProviderStatement({
    internal,
    ...(internalReturns!==undefined ? {internalReturns} : {}),
    links,external:external.data,
    currency:flags.get("--currency"),scale:Number(rawScale)
  });
  // The operator's independent signature binds ALL four input sources to
  // one order, currency and scale. It does not authenticate the provider.
  // Fail closed before consuming a signed provider event's replay marker.
  if(bundleSupplied===3) {
    const bundle=readSource("--operator-bundle-manifest","operator bundle attestation",true).data;
    result.operatorSnapshotAttestation=verifyOperatorSnapshotBundle({
      metadata:bundle,
      snapshots:{internal:internalSnapshot.sha256,
        internalReturns:returnsSnapshot?.sha256??null,
        links:linksSnapshot.sha256,external:external.sha256},
      expectedOrder:expected,currency:flags.get("--currency"),scale:Number(rawScale),
      publicKeyPem:readPinnedPublicKey(flags.get("--operator-public-key")),
      trustedKeySha256:flags.get("--trusted-operator-key-sha256")
    });
  }
  // All sources, including optional signed operator metadata, must be the
  // same inode and bytes after validation, before replay state or stdout.
  assertStatementSnapshotsUnchanged(snapshots);
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
