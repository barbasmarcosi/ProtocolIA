// Read-only inspection of the optional single-host signed-event replay store.
// NEVER removes a crash lock, claims an event, authenticates a provider or
// asserts that a bank cleared money. Local format checks are not tamper proof.
import {createHash} from "node:crypto";
import {openSync,closeSync,fstatSync,lstatSync,statSync,readdirSync,readSync,constants} from "node:fs";
import {resolve,join} from "node:path";

const INVALID="local replay inspection: unsafe or malformed private state";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA=/^[0-9a-f]{64}$/;
const LOCK=/^\.pia-event-lock-([0-9a-f]{64})$/;
const MARKER=/^event-([0-9a-f]{64})$/;
const MAX_FILES=1024;
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
    return value;
  } catch {throw Error(INVALID);}
  finally {if(fd!==undefined)closeSync(fd);}
}

/**
 * Inspects a pinned private directory without changing a single byte.
 * A durable lock is intentionally NOT cleared: an interrupted multi-event
 * claim may have partially committed and requires independent operator review.
 * A clean scan cannot prove that records were never deleted or modified.
 */
export function inspectLocalEventReplay(directory) {
  if(typeof directory!=="string" || directory.length===0)throw Error(INVALID);
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
    let markers=0,locks=0;
    for(const name of names.sort()) {
      const lock=LOCK.exec(name),marker=MARKER.exec(name);
      if(!lock && !marker)throw Error(INVALID);
      const record=readEntry(anchor,name);
      if(lock) {
        if(!exact(record,["version","providerId","statementSha256"]) ||
           record.version!==1 || !ID.test(record.providerId) ||
           !SHA.test(record.statementSha256) ||
           lock[1]!==digest(["ProtocolIA-S2C-provider-lock-v1",record.providerId]))
          throw Error(INVALID);
        locks++;
      } else {
        if(!exact(record,["version","statementSha256","providerId",
          "orderId","eventMarkerSha256"]) ||
           record.version!==1 || !SHA.test(record.statementSha256) ||
           !ID.test(record.providerId) || !ID.test(record.orderId) ||
           record.eventMarkerSha256!==marker[1])
          throw Error(INVALID);
        markers++;
      }
    }
    // Reject observable directory swaps or mutations during the scan.
    if(!same(lstatSync(path),opened) || !privateDir(lstatSync(path)) ||
       !same(fstatSync(dirFd),opened) ||
       names.length!==readdirSync(anchor).length ||
       names.some(name=>!readdirSync(anchor).includes(name)))
      throw Error(INVALID);
    return {state:locks>0?"blocked_manual_review":"no_lock_observed",
      lockCount:locks,eventMarkerCount:markers,
      scope:"single_host_format_inspection_only",
      providerIdentityVerified:false,settlementVerified:false,
      replayCompletenessVerified:false};
  } catch {throw Error(INVALID);}
  finally {if(dirFd!==undefined)closeSync(dirFd);}
}
