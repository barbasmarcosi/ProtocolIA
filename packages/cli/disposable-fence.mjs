// v1.1m: monitor a *manually stopped* app and absence of other active
// PostgreSQL clients in a freshly created DISPOSABLE Compose project.
// This does not revoke SQL credentials or impose a server-wide write lock.
import {spawnSync} from "node:child_process";
import {lstatSync} from "node:fs";
import {resolve} from "node:path";
import {ephemeralCutoverProject} from "./cutover-recovery.mjs";

const deny=m=>{throw Error("Disposable write-fence refused: "+m);};
const hex=/^[a-f0-9]{12,64}$/i;
export function fenceOptions(args){
  if(args.length!==9||args[1]!=="--project"||args[3]!=="--env-file"||
     args[5]!=="--old-app-id"||args[7]!=="--db-id")
    deny("Usage: app:deploy:fence:verify <generated-app> --project <pia_ckpt_hex> --env-file <private.env> --old-app-id <container> --db-id <container>");
  const [dir,,project,,environment,,oldAppId,,dbId]=args;
  ephemeralCutoverProject(project);
  if(!hex.test(oldAppId)||!hex.test(dbId)||oldAppId===dbId)
    deny("Explicit old app and original DB container IDs must differ");
  const env=resolve(environment),cwd=resolve(dir);
  let st;
  try{st=lstatSync(env);}catch{deny("Original Compose env file missing");}
  if(!st.isFile()||(st.mode&0o077)!==0)
    deny("Original Compose env must be owner-only regular file");
  return {cwd,project,env,oldAppId,dbId};
}
function docker(args,{cwd}={}){
  const p=spawnSync("docker",args,{cwd,encoding:"utf8",timeout:30000,maxBuffer:1<<20});
  if(p.error||p.status!==0)
    deny("Read-only Docker inspection failed: "+(p.stderr??p.error?.message??"").slice(-450));
  return (p.stdout??"").trim();
}
export function verifyDisposableFence(args,{runDocker=docker}={}){
  const p=fenceOptions(args);
  const base=["compose","--project-name",p.project,"--env-file",p.env];
  runDocker([...base,"config","--quiet"],{cwd:p.cwd});
  const actualDb=runDocker([...base,"ps","--quiet","db"],{cwd:p.cwd});
  if(actualDb!==p.dbId)deny("Original disposable PostgreSQL container changed");
  const activeApp=runDocker([...base,"ps","--quiet","app"],{cwd:p.cwd});
  if(activeApp)deny("Original writable app is still running");
  const oldState=runDocker(["inspect","--format","{{.State.Running}}",p.oldAppId],
    {cwd:p.cwd});
  if(oldState!=="false")deny("Original app container was not confirmed stopped");
  const query="SELECT count(*) FROM pg_stat_activity WHERE datname='protocolia' "+
    "AND backend_type='client backend' AND pid<>pg_backend_pid()";
  const sessions=runDocker([...base,"exec","-T","db","psql","-X","-U","protocolia",
    "-d","protocolia","-At","-v","ON_ERROR_STOP=1","-c",query],{cwd:p.cwd});
  if(sessions!=="0")deny("Another client SQL session is active on disposable DB");
  if(runDocker([...base,"ps","--quiet","db"],{cwd:p.cwd})!==p.dbId)
    deny("Disposable DB changed during quiescence observation");
  if(runDocker([...base,"ps","--quiet","app"],{cwd:p.cwd}))
    deny("Original app resumed during quiescence observation");
  const result={project:p.project,dbContainerId:p.dbId,oldAppId:p.oldAppId,
    appStopped:true,otherSqlClientSessions:0,
    warning:"Effective only against this stopped disposable app. Docker administrators, external DB clients and future writes are not blocked."};
  console.log("PROTOCOLIA_V11_DISPOSABLE_FENCE_PASS "+JSON.stringify(result));
  return result;
}
