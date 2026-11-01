#!/usr/bin/env node
// Offline comparison; never authenticate a provider or authorize a financial write.
import {readFileSync,lstatSync} from "node:fs";
import {resolve} from "node:path";
import {reconcileProviderStatement} from "../../packages/adapters/provider-statement-reconciliation.mjs";
function load(file, name) {
  const path=resolve(file);
  const stat=lstatSync(path);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>4*1024*1024)
    throw Error(name + ": input must be a regular, non-symlink file <= 4 MiB");
  const data=JSON.parse(readFileSync(path,"utf8"));
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
  if(flags.size!==keys.length || keys.some(key=>!flags.has(key)))
    throw Error("Usage: reconcile-provider-statement --internal receipts.json --links map.json --external statement.json --currency ARS --scale 2");
  const rawScale=flags.get("--scale");
  if(!/^[0-6]$/.test(rawScale)) throw Error("Explicit scale 0..6 required");
  const result=reconcileProviderStatement({
    internal:load(flags.get("--internal"),"internal"),
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
