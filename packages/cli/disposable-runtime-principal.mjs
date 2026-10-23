// v1.1p: a scoped non-superuser application runtime DB account for disposable
// generated-app evolution. Never use on a production/non-pia_ckpt project.
// Flyway and Nest migration bootstrap retain a separate, privileged connection.
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync,lstatSync,readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname,relative,sep,isAbsolute} from "node:path";
import {gateOptions} from "./disposable-db-gate.mjs";
import {verifyExternalApproval} from "./disposable-approval.mjs";
import {verifyDisposableFence} from "./disposable-fence.mjs";

const refuse=why=>{throw Error("Disposable runtime principal refused: "+why);};
const role="protocolia_app_runtime";
const secretPattern=/^[a-f0-9]{48}$/;
function inside(root,p){
  const rel=relative(root,p);
  return rel===""||(rel!==".."&&!rel.startsWith(".."+sep)&&!isAbsolute(rel));
}
export function runtimePrincipalOptions(args,{verify=false}={}){
  if(args.length!==27||args[25]!=="--credentials")
    refuse("Usage: <25 signed disposable gate arguments> --credentials <private-runtime-credentials.json>");
  const gate=gateOptions(args.slice(0,25));
  const file=resolve(args[26]);
  if(!file.endsWith(".json")||!existsSync(dirname(file))||inside(gate.approval.dir,file)||
     (verify&&!existsSync(file))||(!verify&&existsSync(file)))
    refuse("Runtime credential output must be new, private, and outside generated app");
  if(verify){
    const stat=lstatSync(file);
    if(!stat.isFile()||(stat.mode&0o077)!==0)
      refuse("Credential JSON must be owner-only and not a symlink");
  }
  return {...gate,file};
}
export function runtimeRoleStatements(secret){
  if(!secretPattern.test(secret))refuse("Invalid generated SQL secret");
  return [
    "CREATE ROLE "+role+" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '"+secret+"'",
    "GRANT CONNECT ON DATABASE protocolia TO "+role,
    "GRANT USAGE ON SCHEMA public TO "+role,
    "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "+role,
    "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "+role,
    // Migration ledgers must remain opaque and immutable to the runtime.
    "DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE "+
      "schemaname='public' AND tablename IN ('flyway_schema_history',"+
      "'protocolia_schema_history','protocolia_nest_migration_history') LOOP "+
      "EXECUTE format('REVOKE ALL ON public.%I FROM "+role+"',t.tablename); "+
      "END LOOP; END; $$"
  ];
}
function execDocker(args,{cwd,input,allowFailure=false}={}){
  const p=spawnSync("docker",args,{cwd,encoding:"utf8",
    input,timeout:30000,maxBuffer:1<<20});
  if(p.error||(!allowFailure&&p.status!==0))
    refuse("Docker/PostgreSQL command failed: "+(p.stderr??p.error?.message??"").slice(-350));
  return allowFailure?{status:p.status,stderr:p.stderr??""}:(p.stdout??"").trim();
}
function dbClient(base,sql,{database="postgres",run,cwd}={}){
  // Supply SQL through stdin, not argv: keep private role passwords out of
  // process command-line metadata and action logging.
  return run([...base,"exec","-T","db","psql","-X","-q","-U","protocolia",
    "-d",database,"-At","-v","ON_ERROR_STOP=1"],{cwd,input:sql+"\n"});
}
export function readRuntimeCredentials(path,project){
  const stat=lstatSync(path);
  if(!stat.isFile()||(stat.mode&0o077)!==0)
    refuse("Runtime credential file permissions must be owner-only");
  let record;
  try{record=JSON.parse(readFileSync(path,"utf8"));}
  catch{refuse("Unreadable runtime credential file");}
  if(record.schema!==1||record.project!==project||record.role!==role||
     !secretPattern.test(record.password))refuse("Runtime principal binding is invalid");
  return record;
}
export function provisionDisposableRuntime(args,{
  run=execDocker,verifyApproval=verifyExternalApproval,
  verifyStopped=verifyDisposableFence
}={}){
  const o=runtimePrincipalOptions(args);
  const signed=verifyApproval(args.slice(0,19));
  if(signed.project!==o.fence.project)refuse("Wrong signed disposable project");
  verifyStopped(o.fenceArgs);
  const base=["compose","--project-name",o.fence.project,"--env-file",o.fence.env];
  const inspect=a=>run([...base,...a],{cwd:o.fence.cwd});
  if(inspect(["ps","--quiet","db"])!==o.fence.dbId||
     inspect(["ps","--quiet","app"])!=="")
    refuse("Old app must be stopped and original PostgreSQL unchanged");
  const query=(sql,db="postgres")=>dbClient(base,sql,{database:db,run,cwd:o.fence.cwd});
  if(query("SELECT count(*) FROM pg_roles WHERE rolname='"+role+"'")!=="0")
    refuse("Runtime principal already exists; never rotate a live identity");
  const pwd=randomBytes(24).toString("hex");
  for(const sql of runtimeRoleStatements(pwd))
    query(sql,sql.startsWith("GRANT CONNECT")||sql.startsWith("CREATE ROLE")?"postgres":"protocolia");
  const roleCheck=query("SELECT (rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole)::text "+
    "FROM pg_roles WHERE rolname='"+role+"'");
  if(!["true","t"].includes(roleCheck))refuse("Runtime SQL principal is overprivileged or inaccessible");
  const noDdl=query("SELECT (NOT has_schema_privilege('"+role+"','public','CREATE'))::text","protocolia");
  if(!["true","t"].includes(noDdl))refuse("Runtime principal unexpectedly has schema DDL permission");
  const record={schema:1,project:o.fence.project,role,password:pwd};
  writeFileSync(o.file,JSON.stringify(record)+"\n",{mode:0o600,flag:"wx"});
  console.log("PROTOCOLIA_V11_RUNTIME_PRINCIPAL_READY "+JSON.stringify({
    project:o.fence.project,role,notSuperuser:true,cannotCreateSchemaObjects:true,
    migrationCredentialsSeparate:true
  }));
  return record;
}
