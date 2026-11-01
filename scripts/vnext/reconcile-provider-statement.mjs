#!/usr/bin/env node
// Offline comparison; never authenticate a provider or authorize a financial write.
import {loadStatementArray} from "../../packages/adapters/provider-statement-input.mjs";
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
  const optional=["--internal-returns","--expected-order"];
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
  const result=reconcileProviderStatement({
    internal,
    ...(flags.has("--internal-returns") ?
      {internalReturns:loadStatementArray(flags.get("--internal-returns"),"internalReturns")} : {}),
    links:loadStatementArray(flags.get("--links"),"links"),
    external:loadStatementArray(flags.get("--external"),"external"),
    currency:flags.get("--currency"),scale:Number(rawScale)
  });
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  process.exitCode=result.counts.exceptions ? 2 : 0;
} catch(error) {
  // Avoid logging contents of sensitive external statements on parse errors.
  process.stderr.write("RECONCILIATION_INPUT_REJECTED: "+String(error.message).slice(0,250)+"\n");
  process.exitCode=1;
}
