#!/usr/bin/env node
// Read-only diagnostic for the optional local signed-event replay store.
// Exit 0: no lock observed; 2: lock requires manual review; 1: invalid state.
// Never removes locks, markers or performs provider/financial operations.
import {inspectLocalEventReplay} from "../../packages/adapters/provider-statement-replay-inspection.mjs";
try {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=="--local-event-replay-dir" ||
     !args[1] || args[1].startsWith("--"))
    throw Error("expected --local-event-replay-dir");
  const result=inspectLocalEventReplay(args[1]);
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  process.exitCode=result.lockCount>0?2:0;
} catch {
  process.stderr.write("REPLAY_INSPECTION_REJECTED: unsafe or malformed private state\n");
  process.exitCode=1;
}
