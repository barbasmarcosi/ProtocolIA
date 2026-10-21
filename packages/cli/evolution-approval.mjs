// Explicit binding between a successfully rehearsed SQL migration and an
// imminent generated-app evolution. This is a local integrity guard, NOT a
// signature, production approval, nor a substitute for maintenance backups.
import {createHash} from "node:crypto";
import {lstatSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {verifyCheckpoint} from "./database-checkpoint.mjs";

const digest=value=>createHash("sha256").update(value).digest("hex");
const refuse=reason=>{throw Error("Verified evolution refused: "+reason);};
export function verifyEvolutionApproval({reportPath,archivePath,build,newIr,sql,changeCount}){
  if(typeof reportPath!=="string"||!reportPath||
     typeof archivePath!=="string"||!archivePath)
    refuse("An explicit preflight report and its checkpoint archive are required");
  let stat,report;
  try{
    stat=lstatSync(resolve(reportPath));
    if(!stat.isFile()||(stat.mode&0o077)!==0)
      refuse("Approval report must be an owner-only regular file, not a symlink");
    report=JSON.parse(readFileSync(resolve(reportPath),"utf8"));
  }catch(error){
    if(String(error).includes("Verified evolution refused"))throw error;
    refuse("Cannot read or parse the preflight report");
  }
  if(typeof sql!=="string"||!sql.trim()||
     !newIr||typeof newIr!=="object"||
     !build||typeof build!=="object")
    refuse("Verified evolution requires a canonical nonempty SQL migration");
  // Recheck actual archive bytes right before staging, not just the copied
  // report hash. Tampering or using a different snapshot must fail closed.
  const checkpoint=verifyCheckpoint(archivePath);
  const expected={
    schema:1,status:"pass",target:build.target,
    sourceContractSha256:build.contractSha256,
    checkpointSha256:checkpoint.archiveSha256,
    proposedSqlSha256:digest(sql),
    proposedIrSha256:digest(JSON.stringify(newIr)),
    changeCount
  };
  for(const [name,value] of Object.entries(expected)){
    if(report[name]!==value)
      refuse("Preflight does not match the imminent schema evolution: "+name);
  }
  if(checkpoint.contractSha256!==build.contractSha256||
     checkpoint.target!==build.target||
     report.isolatedNetwork!=="none"||report.originDatabaseAccess!==false||
     !Number.isSafeInteger(report.tablesChecked)||report.tablesChecked<1||
     !Number.isSafeInteger(report.rowsChecked)||report.rowsChecked<0)
    refuse("Checkpoint or isolated rehearsal evidence is incomplete");
  console.log("PROTOCOLIA_EVOLUTION_PREFLIGHT_VERIFIED "+JSON.stringify({
    target:build.target,sourceContractSha256:build.contractSha256,
    checkpointSha256:checkpoint.archiveSha256,
    proposedSqlSha256:expected.proposedSqlSha256,
    proposedIrSha256:expected.proposedIrSha256,
    rowsChecked:report.rowsChecked,tablesChecked:report.tablesChecked
  }));
  return expected;
}
