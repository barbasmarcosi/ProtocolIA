// Read-only inspection of the optional single-host signed-event replay store.
// NEVER removes a crash lock, claims an event, authenticates a provider or
// asserts that a bank cleared money. Local format checks are not tamper proof.
import {createHash} from "node:crypto";
import {openSync,closeSync,fstatSync,lstatSync,statSync,readdirSync,readSync,constants} from "node:fs";
import {resolve,join} from "node:path";

const INVALID="local replay inspection: unsafe or malformed private state";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA=/^[0-9a-f]{64}$/;
const MONEY=/^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$/;
const CURRENCY=/^[A-Z]{3}$/;
const validAmount=value=>typeof value==="string" && MONEY.test(value) &&
  value.split(".")[0].length<=38 && !/^0(?:\\.0+)?$/.test(value);
const LOCK=/^\.pia-event-lock-([0-9a-f]{64})$/;
const MARKER=/^event-([0-9a-f]{64})$/;
const MAX_FILES=20000;
const MAX_BYTES=1024;
const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same=(a,b)=>a.dev===b.dev && a.ino===b.ino;
const privateDir=s=>s.isDirectory() && !s.isSymbolicLink() &&
  (s.mode&0o077)===0 && typeof process.getuid==="function" &&
  s.uid===process.getuid();
const exact=(o,fields)=>o!==null && typeof o==="object" &&
  !Array.isArray(o) && Object.keys(o).length===fields.length &&
  fields.every(k=>Object.hasOwn(o,k));

function readEntry(anchor,name) {
  let fd;
  try {
    fd=openSync(join(anchor,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const before=fstatSync(fd);
    if(!before.isFile() || before.nlink!==1 || before.size<1 ||
       before.size>MAX_BYTES || (before.mode&0o077)!==0 ||
       before.uid!==process.getuid())throw Error(INVALID);
    const bytes=Buffer.alloc(before.size+1);
    let used=0;
    while(used<bytes.length) {
      const n=readSync(fd,bytes,used,bytes.length-used,null);
      if(n===0)break;
      used+=n;
    }
    const after=fstatSync(fd);
    if(used!==before.size || !same(before,after) ||
       after.size!==before.size || after.mtimeMs!==before.mtimeMs ||
       after.ctimeMs!==before.ctimeMs)throw Error(INVALID);
    const raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,used));
    const value=JSON.parse(raw);
    // All replay records are generated as one canonical JSON line. This
    // rejects duplicate JSON keys and alternate parsing interpretations.
    if(JSON.stringify(value)+"\n"!==raw)throw Error(INVALID);
    return {value,sha256:createHash("sha256").update(bytes.subarray(0,used)).digest("hex"),
      identity:{dev:after.dev,ino:after.ino,size:after.size,
        mtimeMs:after.mtimeMs,ctimeMs:after.ctimeMs}};
  } catch {throw Error(INVALID);}
  finally {if(fd!==undefined)closeSync(fd);}
}

/**
 * Inspects a pinned private directory without changing a single byte.
 * A durable lock is intentionally NOT cleared: an interrupted multi-event
 * claim may have partially committed and requires independent operator review.
 * A clean scan cannot prove that records were never deleted or modified.
 */
export function inspectLocalEventReplay(directory,{excludeEventMarkers=[],providerId}={}) {
  if((providerId!==undefined && (typeof providerId!=="string" || !ID.test(providerId))) ||
     typeof directory!=="string" || directory.length===0 ||
     !Array.isArray(excludeEventMarkers) || excludeEventMarkers.length>512 ||
     new Set(excludeEventMarkers).size!==excludeEventMarkers.length ||
     excludeEventMarkers.some(name=>typeof name!=="string" || !MARKER.test(name)))
    throw Error(INVALID);
  const excluded=new Set(excludeEventMarkers);
  let dirFd;
  try {
    const path=resolve(directory);
    const before=lstatSync(path);
    if(!privateDir(before))throw Error(INVALID);
    dirFd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    const opened=fstatSync(dirFd);
    if(!same(before,opened) || !privateDir(opened))throw Error(INVALID);
    const anchor=`/proc/self/fd/${dirFd}`;
    if(process.platform!=="linux" || !same(statSync(anchor),opened))
      throw Error(INVALID);
    const names=readdirSync(anchor);
    if(names.length>MAX_FILES)throw Error(INVALID);
    let markers=0,locks=0,legacyUnboundMarkers=0;
    const observed=[];
    for(const name of names.sort()) {
      const lock=LOCK.exec(name),marker=MARKER.exec(name);
      if(!lock && !marker)throw Error(INVALID);
      const entry=readEntry(anchor,name);
      const record=entry.value;
      observed.push({name,sha256:entry.sha256,identity:entry.identity,
        markerProviderId:marker ? record.providerId : null});
      if(lock) {
        if(!exact(record,["version","providerId","statementSha256"]) ||
           record.version!==1 || !ID.test(record.providerId) ||
           !SHA.test(record.statementSha256) ||
           lock[1]!==digest(["ProtocolIA-S2C-provider-lock-v1",record.providerId]))
          throw Error(INVALID);
        locks++;
      } else {
        const legacy=record.version===1;
        const v2=record.version===2;
        if(!(legacy || v2) ||
           !exact(record,legacy ? ["version","statementSha256","providerId",
             "orderId","eventMarkerSha256"] :
             ["version","statementSha256","providerId","orderId","eventId",
              "transactionId","kind","amount","currency","eventMarkerSha256"]) ||
           !SHA.test(record.statementSha256) ||
           !ID.test(record.providerId) || !ID.test(record.orderId) ||
           record.eventMarkerSha256!==marker[1])throw Error(INVALID);
        if(v2 && (!ID.test(record.eventId) || !ID.test(record.transactionId) ||
           !["capture","refund","chargeback"].includes(record.kind) ||
           !validAmount(record.amount) || !CURRENCY.test(record.currency) ||
           marker[1]!==digest(["ProtocolIA-S2C-event-v1",
             record.providerId,record.eventId])))throw Error(INVALID);
        if(legacy)legacyUnboundMarkers++;
        markers++;
      }
    }
    // Reject observable directory swaps or mutations during the scan.
    const finalPath=lstatSync(path);
    const finalNames=readdirSync(anchor);
    const finalSet=new Set(finalNames);
    if(!same(finalPath,opened) || !privateDir(finalPath) ||
       !same(fstatSync(dirFd),opened) ||
       names.length!==finalNames.length ||
       names.some(name=>!finalSet.has(name)))
      throw Error(INVALID);
    // A second descriptor-bound pass detects observable in-place edits and
    // same-name inode substitutions during the first pass. It is not an
    // atomic filesystem snapshot and cannot prevent later tampering.
    for(const entry of observed) {
      const fresh=readEntry(anchor,entry.name);
      if(fresh.sha256!==entry.sha256 ||
         !same(fresh.identity,entry.identity) ||
         fresh.identity.size!==entry.identity.size ||
         fresh.identity.mtimeMs!==entry.identity.mtimeMs ||
         fresh.identity.ctimeMs!==entry.identity.ctimeMs)
        throw Error(INVALID);
    }
    const finalPathAfter=lstatSync(path);
    const namesAfter=readdirSync(anchor);
    const namesAfterSet=new Set(namesAfter);
    if(!same(finalPathAfter,opened) || !privateDir(finalPathAfter) ||
       !same(fstatSync(dirFd),opened) ||
       namesAfter.length!==names.length ||
       names.some(name=>!namesAfterSet.has(name)))throw Error(INVALID);
    const witness=createHash("sha256");
    const markerWitness=createHash("sha256");
    const historicalWitness=createHash("sha256");
    // Optional provider-scoped history fence: unrelated providers may append
    // while our provider lock is held. This is a freshness check, not an
    // independent completeness or anti-rollback checkpoint.
    const providerWitness=createHash("sha256");
    const providerHistoricalWitness=createHash("sha256");
    let providerMarkers=0,providerExcluded=0;
    let excludedFound=0;
    witness.update("ProtocolIA-S2C-local-replay-snapshot-v1\n");
    // Exclude transient provider locks from the separately pinnable marker
    // checkpoint. This digest is only meaningful if retained independently.
    markerWitness.update("ProtocolIA-S2C-event-marker-checkpoint-v1\n");
    historicalWitness.update("ProtocolIA-S2C-event-marker-checkpoint-v1\n");
    providerWitness.update("ProtocolIA-S2C-provider-marker-history-v1\n"+providerId+"\n");
    providerHistoricalWitness.update("ProtocolIA-S2C-provider-marker-history-v1\n"+providerId+"\n");
    for(const entry of observed) {
      const line=JSON.stringify([entry.name,entry.sha256])+"\n";
      witness.update(line);
      if(MARKER.test(entry.name)) {
        markerWitness.update(line);
        if(excluded.has(entry.name))excludedFound++;
        else historicalWitness.update(line);
        if(providerId!==undefined && entry.markerProviderId===providerId) {
          providerMarkers++;
          providerWitness.update(line);
          if(excluded.has(entry.name))providerExcluded++;
          else providerHistoricalWitness.update(line);
        }
      }
    }
    if(excludedFound!==excluded.size)throw Error(INVALID);
    return {state:locks>0?"blocked_manual_review":"no_lock_observed",
      snapshotSha256:witness.digest("hex"),
      eventMarkersSha256:markerWitness.digest("hex"),
      ...(providerId===undefined ? {} : {
        providerEventMarkersSha256:providerWitness.digest("hex"),
        remainingProviderEventMarkersSha256:providerHistoricalWitness.digest("hex"),
        providerEventMarkerCount:providerMarkers,
        excludedProviderEventMarkerCount:providerExcluded}),
      ...(excluded.size===0 ? {} : {
        remainingEventMarkersSha256:historicalWitness.digest("hex"),
        excludedEventMarkerCount:excludedFound}),
      lockCount:locks,eventMarkerCount:markers,
      legacyUnboundEventMarkerCount:legacyUnboundMarkers,
      scope:"single_host_format_inspection_only",
      providerIdentityVerified:false,settlementVerified:false,
      replayCompletenessVerified:false};
  } catch {throw Error(INVALID);}
  finally {if(dirFd!==undefined)closeSync(dirFd);}
}
