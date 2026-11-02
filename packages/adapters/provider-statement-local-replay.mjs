// Optional single-host, fail-closed replay marker for an already verified
// detached statement. Not a distributed database, provider identity check,
// or proof of settlement. A crash after O_EXCL may consume the snapshot.
import {createHash} from "node:crypto";
import {openSync,closeSync,fsyncSync,fstatSync,lstatSync,statSync,constants} from "node:fs";
import {resolve,join} from "node:path";

const INVALID="local replay guard: private directory required or statement already consumed";
const same=(a,b)=>a.dev===b.dev && a.ino===b.ino;
function privateDirectory(stat) {
  return stat.isDirectory() && !stat.isSymbolicLink() &&
    (stat.mode & 0o077)===0 &&
    typeof process.getuid==="function" && stat.uid===process.getuid();
}

/**
 * Consumes a signed statement ONCE per trusted local directory. Only call
 * after signature and financial input validation, before emitting a report.
 * The O_EXCL create is the linearization point across concurrent processes.
 * A failed fsync or crash is fail-closed: the marker may remain.
 */
export function consumeLocalSignedStatement({directory,metadata}) {
  if(typeof directory!=="string" || directory.length===0 ||
     !metadata || typeof metadata!=="object" ||
     !/^[0-9a-f]{64}$/.test(metadata.statementSha256) ||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(metadata.providerId) ||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(metadata.orderId))
    throw Error(INVALID);
  const token=createHash("sha256").update(JSON.stringify([
    "ProtocolIA-S2C-local-replay-v1",metadata.providerId,
    metadata.orderId,metadata.statementSha256
  ])).digest("hex");
  let directoryFd,markerFd;
  try {
    const path=resolve(directory);
    const before=lstatSync(path);
    if(!privateDirectory(before))throw Error(INVALID);
    directoryFd=openSync(path,constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const opened=fstatSync(directoryFd);
    if(!same(before,opened) || !privateDirectory(opened))throw Error(INVALID);
    // Never create a replay marker via the mutable directory pathname.
    // Pin writes to the already verified directory inode even if its parent
    // is concurrently renamed. Unsupported hosts fail closed.
    const anchor=`/proc/self/fd/${directoryFd}`;
    if(process.platform!=="linux" || !same(statSync(anchor),opened))throw Error(INVALID);
    markerFd=openSync(join(anchor,token),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,0o600);
    const marker=fstatSync(markerFd);
    if(!marker.isFile() || marker.nlink!==1 || (marker.mode & 0o077)!==0)
      throw Error(INVALID);
    fsyncSync(markerFd);
    // Ensure the directory name still resolves to the opened directory.
    if(!same(lstatSync(path),opened))throw Error(INVALID);
    fsyncSync(directoryFd);
    return {replayProtection:"single_host_local_marker",markerSha256:token};
  } catch {
    // Never remove a marker on error: the operation might already have
    // linearized and deleting it could permit a concurrent duplicate.
    throw Error(INVALID);
  } finally {
    if(markerFd!==undefined)closeSync(markerFd);
    if(directoryFd!==undefined)closeSync(directoryFd);
  }
}
