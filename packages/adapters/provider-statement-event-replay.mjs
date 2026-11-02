// Opt-in single-host event-ID replay gate for previously verified signed
// provider statements. NOT distributed replay protection or bank settlement.
// A crash can leave a persistent provider lock requiring manual recovery.
import {createHash} from "node:crypto";
import {openSync,closeSync,fsyncSync,fstatSync,lstatSync,writeFileSync,
  unlinkSync,statSync,constants} from "node:fs";
import {resolve,join} from "node:path";
import {inspectLocalEventReplay} from "./provider-statement-replay-inspection.mjs";

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
    // The replay directory must be pinned by its opened descriptor. Pathname
    // checks alone cannot prevent a concurrent parent-directory rename from
    // redirecting O_EXCL marker writes into an attacker-substituted directory.
    // Linux /proc/self/fd is the openat-like anchor available to Node fs.
    // Fail closed on hosts without it rather than claim replay protection.
    const anchor=`/proc/self/fd/${dirFd}`;
    if(process.platform!=="linux" || !same(statSync(anchor),opened))throw Error(INVALID);
    const entry=name=>join(anchor,name);
    // A private directory with corrupted, foreign or unreviewed crash state
    // must never be used to claim additional financial events. The scanner
    // verifies every existing marker (not just requested event IDs).
    // This is format integrity, NOT proof that markers were never deleted.
    const beforeClaim=inspectLocalEventReplay(path);
    if(beforeClaim.state!=="no_lock_observed" || beforeClaim.lockCount!==0)
      throw Error(INVALID);
    // Lock is per provider, NOT per order, so two different orders cannot
    // claim the same provider event ID concurrently.
    lockFd=openSync(entry(lockName),
      constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    writeFileSync(lockFd,JSON.stringify({version:1,providerId:metadata.providerId,
      statementSha256:metadata.statementSha256})+"\n");
    fsyncSync(lockFd);
    // Retain the exact lock inode and metadata written by this process.
    // O_EXCL alone is insufficient if another actor replaces the pathname
    // between the forensic scan and the final unlink.
    const writtenLock=fstatSync(lockFd);
    const assertOwnLock=()=>{
      checkDirectory(opened);
      const current=lstatSync(entry(lockName));
      const owned=fstatSync(lockFd);
      if(!same(current,owned) || !same(owned,writtenLock) ||
         !current.isFile() || current.nlink!==1 ||
         current.uid!==process.getuid() || (current.mode & 0o077)!==0 ||
         current.size!==writtenLock.size || owned.size!==writtenLock.size ||
         current.mtimeMs!==writtenLock.mtimeMs ||
         owned.mtimeMs!==writtenLock.mtimeMs ||
         current.ctimeMs!==writtenLock.ctimeMs ||
         owned.ctimeMs!==writtenLock.ctimeMs)
        throw Error(INVALID);
    };
    checkDirectory(opened);
    fsyncSync(dirFd);
    // Reinspect after obtaining our exclusive provider lock: the first scan
    // alone has a TOCTOU gap. Require exactly our own canonical lock and
    // validate every historical marker. Do NOT require the original marker
    // count: a prior contender can legitimately finish before this process
    // acquires the lock; the duplicate-event preflight below must then release
    // our lock rather than strand a false crash state.
    const lockedState=inspectLocalEventReplay(path);
    // Our O_EXCL lock is still open and no event markers have been written.
    // A different provider can legitimately acquire its own lock between
    // the clean preflight and this second scan. Never strand OUR lock just
    // because two well-formed provider locks overlapped: that would turn
    // ordinary concurrency into a durable crash state for later requests.
    // This release is ONLY safe before our first marker write and after a
    // successful whole-directory inspection. Corrupt/unsafe scans still
    // retain the lock for manual investigation.
    const releaseUnwrittenLock=()=>{
      assertOwnLock();
      unlinkSync(entry(lockName));
      fsyncSync(dirFd);
    };
    // A count of one does not prove it is OUR lock. An attacker can remove
    // our pathname and substitute a different valid provider lock during the
    // post-acquisition scan. Never claim events without our original lock.
    if(lockedState.lockCount!==1) {
      releaseUnwrittenLock();
      throw Error(INVALID);
    }
    assertOwnLock();
    // No mutation of event markers if a previous statement already owns ANY
    // event. A duplicate must not poison unrelated future statements.
    if(markers.some(name=>!absent(entry(name)))) {
      releaseUnwrittenLock();
      throw Error(INVALID);
    }
    for(const name of markers) {
      let fd;
      try {
        fd=openSync(entry(name),
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
    // Never delete a substituted lock: preserve partial markers and require
    // manual recovery instead of reporting a successful replay claim.
    assertOwnLock();
    unlinkSync(entry(lockName));
    fsyncSync(dirFd);
    return {replayProtection:"single_host_local_event_markers",
      consumedEventCount:markers.length};
  } catch {
    // A crash or I/O failure after lock creation may leave partial markers.
    // Keeping the provider lock blocks later acceptance until manual review.
    // Only inspected no-write duplicates and cross-provider contention release
    // their own descriptor-verified lock before throwing.
    throw Error(INVALID);
  } finally {
    if(lockFd!==undefined)closeSync(lockFd);
    if(dirFd!==undefined)closeSync(dirFd);
  }
}
