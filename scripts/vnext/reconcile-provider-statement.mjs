#!/usr/bin/env node
// Offline comparison; never authenticate a provider or authorize a financial write.
import {openSync,closeSync,fstatSync,lstatSync,readSync,constants} from "node:fs";
import {resolve} from "node:path";
import {reconcileProviderStatement} from "../../packages/adapters/provider-statement-reconciliation.mjs";
const MAX_INPUT_BYTES=4*1024*1024;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function load(file, name) {
  const path=resolve(file);
  // lstat is a portability check; O_NOFOLLOW closes the check/open symlink
  // swap on Linux. O_NONBLOCK prevents a substituted FIFO from hanging.
  let initial, fd;
  try {
    initial=lstatSync(path);
    if(!initial.isFile() || initial.isSymbolicLink())
      throw Error("not regular");
    fd=openSync(path,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw Error(name + ": input must be an accessible regular, non-symlink file");
  }
  let data;
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile() || stat.size>MAX_INPUT_BYTES)
      throw Error(name + ": input must be a regular file <= 4 MiB");
    // Read at most 4 MiB + 1 bytes from the opened inode, never a path that
    // can be swapped after validation. Reject concurrent modification.
    const buffer=Buffer.allocUnsafe(Math.min(stat.size+1,MAX_INPUT_BYTES+1));
    let used=0;
    while(used<buffer.length) {
      const count=readSync(fd,buffer,used,buffer.length-used,null);
      if(count===0)break;
      used+=count;
    }
    const after=fstatSync(fd);
    if(used>MAX_INPUT_BYTES || used!==stat.size ||
       after.size!==stat.size || after.mtimeMs!==stat.mtimeMs ||
       after.ctimeMs!==stat.ctimeMs)
      throw Error(name + ": input changed during read or exceeded 4 MiB");
    try { data=JSON.parse(buffer.toString("utf8",0,used)); }
    catch { throw Error(name + ": invalid JSON"); }
  } finally {
    closeSync(fd);
  }
  if(!Array.isArray(data)) throw Error(name + ": expected JSON array");
  return data;
}
try {
  const args=process.argv.slice(2);
  const flags=new Map();
  for(let i=0;i<args.length;i+=2) {
    if(!args[i]?.startsWith("--") || args[i+1]===undefined || flags.has(args[i]))
      throw Error("Duplicate, missing or malformed flag");
    flags.set(args[i],args[i+1]);
  }
  const keys=["--internal","--links","--external","--currency","--scale"];
  const optional=["--internal-returns","--expected-order"];
  if(flags.size<keys.length || flags.size>keys.length+optional.length ||
     keys.some(key=>!flags.has(key)) ||
     [...flags.keys()].some(key=>![...keys,...optional].includes(key)))
    throw Error("Usage: reconcile-provider-statement --internal receipts.json [--expected-order OT-1] [--internal-returns returns.json] --links map.json --external statement.json --currency ARS --scale 2");
  const rawScale=flags.get("--scale");
  if(!/^[0-6]$/.test(rawScale)) throw Error("Explicit scale 0..6 required");
  const internal=load(flags.get("--internal"),"internal");
  if(flags.has("--expected-order")) {
    const expected=flags.get("--expected-order");
    if(!ID.test(expected) || internal.length===0 ||
       internal.some(row=>row?.orderId!==expected))
      throw Error("internal: snapshot missing or outside expected order");
  }
  const result=reconcileProviderStatement({
    internal,
    ...(flags.has("--internal-returns") ?
      {internalReturns:load(flags.get("--internal-returns"),"internalReturns")} : {}),
    links:load(flags.get("--links"),"links"),
    external:load(flags.get("--external"),"external"),
    currency:flags.get("--currency"),scale:Number(rawScale)
  });
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  process.exitCode=result.counts.exceptions ? 2 : 0;
} catch(error) {
  // Avoid logging contents of sensitive external statements on parse errors.
  process.stderr.write("RECONCILIATION_INPUT_REJECTED: "+String(error.message).slice(0,250)+"\n");
  process.exitCode=1;
}
