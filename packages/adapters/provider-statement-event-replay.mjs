// Opt-in single-host event-ID replay gate for previously verified signed
// provider statements. NOT distributed replay protection or bank settlement.
// A crash can leave a persistent provider lock requiring manual recovery.
import {createHash} from "node:crypto";
import {openSync,closeSync,fsyncSync,fstatSync,lstatSync,writeFileSync,
  unlinkSync,constants} from "node:fs";
import {resolve,join} from "node:path";

const INVALID="local event replay guard: private state, lock or event already consumed";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA=/^[0-9a-f]{64}$/;
const MAX_EVENTS=512;
const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same=(a,b)=>a.dev===b.dev && a.ino===b.ino;
const privateDir=stat=>stat.isDirectory() && !stat.isSymbolicLink() &&
  (stat.mode & 0o077)===0 &&
  typeof process.getuid==="function" && stat.uid===process.getuid();
function absent(path) {
  try {lstatSync(path);return false;}
  catch(error) {if(error?.code==="ENOENT")return true;throw error;}
}

/**
 * All statements for one provider MUST share the same private directory.
 * A provider-scoped O_EXCL lock serializes event claims across orders. A
 * durable lock remains after a crash, preventing silent partial acceptance.
 * Never auto-delete a stale lock: inspect the directory and previous outcome.
 *
 * Call only after descriptor-bound signature verification and successful
 * financial comparison. Reissued statements containing any old eventId fail.
 */
export function consumeLocalSignedEvents({directory,metadata,external}) {
  if(typeof directory!=="string" || directory.length===0 ||
     !metadata || typeof metadata!=="object" ||
     typeof metadata.providerId!=="string" || !ID.test(metadata.providerId) ||
     typeof metadata.orderId!=="string" || !ID.test(metadata.orderId) ||
     typeof metadata.statementSha256!=="string" || !SHA.test(metadata.statementSha256) ||
     !Array.isArray(external) || external.length<1 ||
     external.length>MAX_EVENTS)throw Error(INVALID);
  const ids=new Set();
  for(const row of external) {
    if(!row || typeof row!=="object" || Array.isArray(row) ||
       row.providerId!==metadata.providerId ||
       typeof row.eventId!=="string" || !ID.test(row.eventId) ||
       typeof row.transactionId!=="string" || !ID.test(row.transactionId) ||
       !["capture","refund","chargeback"].includes(row.kind) ||
       typeof row.amount!=="string" || typeof row.currency!=="string" ||
       ids.has(row.eventId))throw Error(INVALID);
    ids.add(row.eventId);
  }
  const markers=[...ids].map(id=>"event-"+digest([
    "ProtocolIA-S2C-event-v1",metadata.providerId,id])).sort();
  const lockName=".pia-event-lock-"+digest([
    "ProtocolIA-S2C-provider-lock-v1",metadata.providerId]);
  let dirFd,lockFd;
  const path=resolve(directory);
  const checkDirectory=opened=>{
    if(!same(lstatSync(path),opened) || !privateDir(opened))throw Error(INVALID);
  };
  try {
    const before=lstatSync(path);
    if(!privateDir(before))throw Error(INVALID);
    dirFd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    const opened=fstatSync(dirFd);
    if(!same(before,opened) || !privateDir(opened))throw Error(INVALID);
    // Lock is per provider, NOT per order, so two different orders cannot
    // claim the same provider event ID concurrently.
    lockFd=openSync(join(path,lockName),
      constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    writeFileSync(lockFd,JSON.stringify({version:1,providerId:metadata.providerId,
      statementSha256:metadata.statementSha256})+"\n");
    fsyncSync(lockFd);
    checkDirectory(opened);
    fsyncSync(dirFd);
    // No mutation of event markers if a previous statement already owns ANY
    // event. A duplicate must not poison unrelated future statements.
    if(markers.some(name=>!absent(join(path,name)))) {
      checkDirectory(opened);
      unlinkSync(join(path,lockName));
      fsyncSync(dirFd);
      throw Error(INVALID);
    }
    for(const name of markers) {
      let fd;
      try {
        fd=openSync(join(path,name),
          constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
        const stat=fstatSync(fd);
        if(!stat.isFile() || stat.nlink!==1 || (stat.mode & 0o077)!==0)
          throw Error(INVALID);
        writeFileSync(fd,JSON.stringify({version:1,statementSha256:metadata.statementSha256,
          providerId:metadata.providerId,orderId:metadata.orderId,
          eventMarkerSha256:name.slice(6)})+"\n");
        fsyncSync(fd);
      } finally {if(fd!==undefined)closeSync(fd);}
    }
    checkDirectory(opened);
    fsyncSync(dirFd); // Event claims durable before lock removal.
    unlinkSync(join(path,lockName));
    fsyncSync(dirFd);
    return {replayProtection:"single_host_local_event_markers",
      consumedEventCount:markers.length};
  } catch {
    // A crash or I/O failure after lock creation may leave partial markers.
    // Keeping the provider lock blocks later acceptance until manual review.
    // Only the known no-write duplicate path releases the lock.
    throw Error(INVALID);
  } finally {
    if(lockFd!==undefined)closeSync(lockFd);
    if(dirFd!==undefined)closeSync(dirFd);
  }
}
