// v1.1n: disposable PostgreSQL connection barrier plus a one-time signed
// permit ledger in the separate postgres maintenance DB. NEVER production.
// The database is intentionally left closed if the caller crashes after
// engagement; only an authorized release or manual CI cleanup reopens it.
import {spawnSync} from "node:child_process";
import {approvalOptions,verifyExternalApproval} from "./disposable-approval.mjs";
import {fenceOptions,verifyDisposableFence} from "./disposable-fence.mjs";

const deny=m=>{throw Error("Disposable PostgreSQL gate refused: "+m);};
const hex=/^[a-f0-9]{12,64}$/i;
const noncePattern=/^[a-f0-9]{32,64}$/;
const gateTable="public.protocolia_disposable_cutover_gate_v1";
export function gateOptions(args){
  if(args.length!==25||args[19]!=="--env-file"||
     args[21]!=="--old-app-id"||args[23]!=="--db-id")
    deny("Usage: <app> <permit-verify flags> --env-file <private.env> --old-app-id <old app container> --db-id <db container>");
  const approval=approvalOptions(args.slice(0,19));
  const fenceArgs=[approval.dir,"--project",approval.project,
    "--env-file",args[20],"--old-app-id",args[22],"--db-id",args[24]];
  const fence=fenceOptions(fenceArgs);
  if(!hex.test(fence.dbId)||!hex.test(fence.oldAppId))
    deny("Invalid fixed original container IDs");
  return {approval,fence,fenceArgs};
}
function docker(args,{cwd,allowFailure=false}={}){
  const p=spawnSync("docker",args,{cwd,encoding:"utf8",timeout:30000,
    maxBuffer:1024*1024});
  if(p.error||(!allowFailure&&p.status!==0))
    deny("PostgreSQL maintenance operation failed: "+
      (p.stderr??p.error?.message??"").slice(-350));
  return allowFailure?{status:p.status,stderr:p.stderr}:(p.stdout??"").trim();
}
export function ledgerSQL(operation,identity){
  const {nonce,permitSha256,project,imageId,dbId}=identity;
  if(!noncePattern.test(nonce)||![permitSha256].every(s=>/^[a-f0-9]{64}$/.test(s))||
     !/^pia_ckpt_[a-f0-9]{10}$/.test(project)||
     !/^sha256:[a-f0-9]{64}$/.test(imageId)||!hex.test(dbId))
    deny("Untrusted values cannot enter PostgreSQL maintenance statements");
  const table=gateTable;
  if(operation==="create")return "CREATE TABLE IF NOT EXISTS "+table+
    " (nonce text PRIMARY KEY, project text NOT NULL, permit_sha256 text NOT NULL,"+
    " image_id text NOT NULL, db_container_id text NOT NULL,"+
    " state text NOT NULL CHECK (state IN ('engaged','released')),"+
    " created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz)";
  if(operation==="consume")return "INSERT INTO "+table+
    " (nonce,project,permit_sha256,image_id,db_container_id,state) VALUES ("+
    ["'"+nonce+"'","'"+project+"'","'"+permitSha256+"'","'"+imageId+"'",
      "'"+dbId+"'","'engaged'"].join(",")+
    ") ON CONFLICT (nonce) DO NOTHING RETURNING nonce";
  const match="nonce='"+nonce+"' AND project='"+project+
    "' AND permit_sha256='"+permitSha256+"' AND image_id='"+imageId+
    "' AND db_container_id='"+dbId+"'";
  if(operation==="inspect")return "SELECT state FROM "+table+" WHERE "+match;
  if(operation==="release")return "UPDATE "+table+
    " SET state='released',released_at=now() WHERE "+match+
    " AND state='engaged' RETURNING nonce";
  deny("Unrecognized maintenance ledger operation");
}
export function gateDatabaseStatements(){
  return {
    status:"SELECT datallowconn::text FROM pg_database WHERE datname='protocolia'",
    close:"ALTER DATABASE protocolia WITH ALLOW_CONNECTIONS false",
    terminate:"SELECT pg_terminate_backend(pid)::text FROM pg_stat_activity "+
      "WHERE datname='protocolia' AND pid<>pg_backend_pid()",
    verifyClosed:"SELECT (NOT datallowconn AND NOT EXISTS ("+
      "SELECT 1 FROM pg_stat_activity WHERE datname='protocolia'))::text "+
      "FROM pg_database WHERE datname='protocolia'",
    open:"ALTER DATABASE protocolia WITH ALLOW_CONNECTIONS true"
  };
}
export function databaseGate(args,{
  mode,runDocker=docker,verifyApproval=verifyExternalApproval,
  verifyStoppedFence=verifyDisposableFence
}={}){
  if(!["engage","release"].includes(mode))deny("Explicit engage or release operation required");
  const {approval,fence,fenceArgs}=gateOptions(args);
  const signed=verifyApproval(args.slice(0,19));
  if(signed.project!==approval.project||!/^[a-f0-9]{64}$/.test(signed.permitSha256)||
     !noncePattern.test(signed.nonce)||!/^sha256:[0-9a-f]{64}$/.test(signed.imageId))
    deny("Verified signed claims do not bind exact disposable project and image");
  // A release also requires the old app to remain stopped, but the original
  // fence uses the protocolia DB and cannot query it while connections closed.
  if(mode==="engage")verifyStoppedFence(fenceArgs);
  const compose=["compose","--project-name",fence.project,"--env-file",fence.env];
  const run=(args,settings={})=>runDocker(args,{cwd:fence.cwd,...settings});
  const db=()=>run([...compose,"ps","--quiet","db"]);
  if(db()!==fence.dbId)deny("Source disposable DB container identity changed");
  if(run([...compose,"ps","--quiet","app"])!=="")
    deny("Old app is not stopped");
  if(run(["inspect","--format","{{.State.Running}}",fence.oldAppId])!=="false")
    deny("Original app container must remain stopped");
  const psql=sql=>run([...compose,"exec","-T","db","psql","-X","-q","-U","protocolia",
    "-d","postgres","-At","-v","ON_ERROR_STOP=1","-c",sql]);
  const identity={nonce:signed.nonce,permitSha256:signed.permitSha256,
    project:signed.project,imageId:signed.imageId,dbId:fence.dbId};
  const sql=gateDatabaseStatements();
  if(mode==="engage"){
    if(psql(sql.status)!=="true"&&psql(sql.status)!=="t")
      deny("Target DB is already closed or missing before engagement");
    psql(ledgerSQL("create",identity));
    if(psql(ledgerSQL("consume",identity))!==signed.nonce)
      deny("Signed nonce has already been consumed: replay forbidden");
    // Fail closed if errors follow. A disposable Compose teardown can recover.
    psql(sql.close);
    psql(sql.terminate);
    if(psql(sql.verifyClosed)!=="true"&&psql(sql.verifyClosed)!=="t")
      deny("Server did not prove zero connections and datallowconn=false");
    if(db()!==fence.dbId||run([...compose,"ps","--quiet","app"])!=="")
      deny("Compose source container identity drifted after engagement");
    console.log("PROTOCOLIA_V11_DB_GATE_ENGAGED "+JSON.stringify({
      project:identity.project,nonce:identity.nonce,dbConnectionsBlocked:true,
      otherClientsTerminated:true,oldAppStopped:true
    }));
    return {...identity,engaged:true};
  }
  if(psql(ledgerSQL("inspect",identity))!=="engaged")
    deny("Release refuses unknown, forged, already released or reused nonce");
  if(psql(sql.verifyClosed)!=="true"&&psql(sql.verifyClosed)!=="t")
    deny("DB is not currently blocked or still has active client connections");
  if(db()!==fence.dbId||run([...compose,"ps","--quiet","app"])!=="")
    deny("Original app/DB changed while the server gate was engaged");
  psql(sql.open);
  if(psql(ledgerSQL("release",identity))!==signed.nonce)
    deny("Replay or race while recording permit consumption");
  console.log("PROTOCOLIA_V11_DB_GATE_RELEASED "+JSON.stringify({
    project:identity.project,nonce:identity.nonce,dbConnectionsReopened:true,
    permitNonceSpent:true,oldAppStopped:true
  }));
  return {...identity,released:true};
}
