#!/usr/bin/env node
// Read-only diagnostic for the optional local signed-event replay store.
// Exit 0: no lock observed; 2: lock requires manual review; 1: invalid state.
// Never removes locks, markers or performs provider/financial operations.
import {inspectLocalEventReplay} from "../../packages/adapters/provider-statement-replay-inspection.mjs";
try {
  const args=process.argv.slice(2);
  if(![2,4,6].includes(args.length))
    throw Error("expected --local-event-replay-dir and optional snapshot pin");
  const flags=new Map();
  for(let i=0;i<args.length;i+=2) {
    if(!["--local-event-replay-dir","--expected-snapshot-sha256",
      "--expected-event-markers-sha256"].includes(args[i]) ||
       flags.has(args[i]) || !args[i+1] || args[i+1].startsWith("--"))
      throw Error("invalid replay inspection flags");
    flags.set(args[i],args[i+1]);
  }
  if(!flags.has("--local-event-replay-dir") ||
     (flags.has("--expected-snapshot-sha256") &&
      !/^[0-9a-f]{64}$/.test(flags.get("--expected-snapshot-sha256"))) ||
     (flags.has("--expected-event-markers-sha256") &&
      !/^[0-9a-f]{64}$/.test(flags.get("--expected-event-markers-sha256"))))
    throw Error("invalid replay inspection snapshot pin");
  const result=inspectLocalEventReplay(flags.get("--local-event-replay-dir"));
  if(flags.has("--expected-snapshot-sha256") &&
     result.snapshotSha256!==flags.get("--expected-snapshot-sha256"))
    throw Error("replay inspection snapshot differs from independent baseline");
  if(flags.has("--expected-event-markers-sha256") &&
     result.eventMarkersSha256!==flags.get("--expected-event-markers-sha256"))
    throw Error("event marker checkpoint differs from independent baseline");
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  process.exitCode=result.lockCount>0?2:0;
} catch {
  process.stderr.write("REPLAY_INSPECTION_REJECTED: unsafe or malformed private state\n");
  process.exitCode=1;
}
