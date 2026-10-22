// v1.1o: separately privileged EXTERNAL DB clients, disposable Compose only.
// The generated app still uses its original privileged migration credentials.
// NEVER expose these test-only actions to arbitrary Compose projects.
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync,lstatSync,readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname,relative,isAbsolute} from "node:path";
import {gateOptions,ledgerSQL} from "./disposable-db-gate.mjs";
import {verifyExternalApproval} from "./disposable-approval.mjs";
import {postcheckCandidate} from "./deployment-candidate.mjs";

const fail=m=>{throw Error("Disposable role policy refused: "+m);};
const hex=/^[0-9a-f]{48}$/;
const reader="protocolia_ci_reader";
const writer="protocolia_ci_writer";
const safe=(root,path)=>{const r=relative(root,path);return !r||!(r===".."||r.startsWith("../")||isAbsolute(r));};
export function roleOptions(args,{mode}={}){
  if(!["prepare","blocked","activate"].includes(mode))fail("Invalid role-policy action");
  const extra=mode==="activate"?["--credentials","--health-url"]:["--credentials"];
  if(args.length!==(mode==="activate"?29:27)||args[25]!==extra[0]||
     (mode==="activate"&&args[27]!==extra[1]))
    fail("Expected the 25 signed disposable gate arguments followed by --credentials <private.json>"+
      (mode==="activate"?" --health-url <loopback-url>":""));
  const gate=gateOptions(args.slice(0,25));
  const file=resolve(args[26]);
  if(safe(gate.approval.dir,file)||!file.endsWith(".json")||!existsSync(dirname(file))||
     (mode==="prepare"&&existsSync(file))||(mode!=="prepare"&&!existsSync(file)))
    fail("Role credentials must be private, mode-appropriate and outside the generated app");
  if(mode!=="prepare"){
    const stat=lstatSync(file);
    if(!stat.isFile()||(stat.mode&0o077)!==0)fail("Credentials must be owner-only regular JSON");
  }
  return {...gate,file,healthUrl:mode==="activate"?args[28]:null};
}
function runDocker(args,{cwd,allowFailure=false}={}){
  const p=spawnSync("docker",args,{cwd,encoding:"utf8",timeout:30000,maxBuffer:1<<20});
  if(p.error||(!allowFailure&&p.status!==0))
    fail("Disposable PostgreSQL role inspection failed: "+(p.stderr??p.error?.message??"").slice(-350));
  return allowFailure?{status:p.status,stderr:p.stderr??""}:(p.stdout??"").trim();
}
export function roleSQL(kind,secret){
  if(kind==="existing")return "SELECT count(*) FROM pg_roles WHERE rolname IN ('"+reader+"','"+writer+"')";
  if(kind==="nonlogin")return "SELECT count(*) FROM pg_roles WHERE rolname IN ('"+
    reader+"','"+writer+"') AND rolcanlogin=false AND rolsuper=false AND rolcreatedb=false AND rolcreaterole=false";
  if(kind==="login")return "SELECT count(*) FROM pg_roles WHERE rolname IN ('"+
    reader+"','"+writer+"') AND rolcanlogin=true AND rolsuper=false AND rolcreatedb=false AND rolcreaterole=false";
  if(kind==="tableCheck")return "SELECT COALESCE(bool_and("+ 
    "has_table_privilege('"+reader+"',format('%I.%I',schemaname,tablename),'SELECT')"+
    " AND NOT has_table_privilege('"+reader+"',format('%I.%I',schemaname,tablename),'UPDATE')"+
    " AND has_table_privilege('"+writer+"',format('%I.%I',schemaname,tablename),'SELECT')"+
    " AND has_table_privilege('"+writer+"',format('%I.%I',schemaname,tablename),'UPDATE')),"+
    "false)::text FROM pg_tables WHERE schemaname='public' AND tablename NOT IN "+
    "('flyway_schema_history','protocolia_nest_migration_history','protocolia_audit_event')";
  if(kind==="firstTable")return "SELECT tablename FROM pg_tables WHERE schemaname='public' "+
    "AND tablename NOT IN ('flyway_schema_history','protocolia_nest_migration_history',"+
    "'protocolia_audit_event') ORDER BY tablename LIMIT 1";
  if(kind==="create"){
    if(!secret||!hex.test(secret.reader)||!hex.test(secret.writer))
      fail("Only generated test secrets may be used in SQL");
    return ["CREATE ROLE "+reader+" NOLOGIN PASSWORD '"+secret.reader+"'",
      "CREATE ROLE "+writer+" NOLOGIN PASSWORD '"+secret.writer+"'"];
  }
  if(kind==="grants")return [
    "REVOKE CONNECT ON DATABASE protocolia FROM PUBLIC",
    "GRANT CONNECT ON DATABASE protocolia TO "+reader+","+writer,
    "GRANT USAGE ON SCHEMA public TO "+reader+","+writer,
    "DO $ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE "+
      "schemaname='public' AND tablename NOT IN "+
      "('flyway_schema_history','protocolia_nest_migration_history',"+
      "'protocolia_audit_event') LOOP "+
      "EXECUTE format('GRANT SELECT ON public.%I TO "+reader+"',t.tablename); "+
      "EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO "+writer+"',t.tablename); "+
      "END LOOP; END $",
    "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "+writer
  ];
  if(kind==="activate")return ["ALTER ROLE "+reader+" LOGIN","ALTER ROLE "+writer+" LOGIN"];
  fail("Unrecognized external role SQL operation");
}
function readCredentials(file,approval,permit){
  let record;
  try{record=JSON.parse(readFileSync(file,"utf8"));}
  catch{fail("Invalid role credentials JSON");}
  if(record?.schema!==1||record.project!==approval.project||
     record.permitSha256!==permit.permitSha256||!hex.test(record.readerPassword)||
     !hex.test(record.writerPassword)||
     record.readerRole!==reader||record.writerRole!==writer)
    fail("Role credentials do not match this exact verified signed permit");
  return record;
}
export async function disposableRolePolicy(args,{mode,run=runDocker,
  verifyApproval=verifyExternalApproval,verifyHealth=postcheckCandidate}={}){
  const opts=roleOptions(args,{mode});
  const permit=verifyApproval(args.slice(0,19));
  if(permit.project!==opts.approval.project||!/^sha256:[0-9a-f]{64}$/.test(permit.imageId))
    fail("Signed permit differs from disposable project or image");
  const base=["compose","--project-name",opts.fence.project,"--env-file",opts.fence.env];
  const docker=(args,settings={})=>run(args,{cwd:opts.fence.cwd,...settings});
  const original=()=>docker([...base,"ps","--quiet","db"]);
  if(original()!==opts.fence.dbId)fail("Original PostgreSQL container changed");
  const psql=(db,sql)=>docker([...base,"exec","-T","db","psql","-X","-q","-U","protocolia",
    "-d",db,"-At","-v","ON_ERROR_STOP=1","-c",sql]);
  if(mode==="prepare"){
    if(docker([...base,"ps","--quiet","app"])!=="")
      fail("Must stop old app before preparing distinct external SQL identities");
    if(psql("postgres",roleSQL("existing"))!=="0")
      fail("External roles already exist; never reset an existing user");
    const secret={reader:randomBytes(24).toString("hex"),
      writer:randomBytes(24).toString("hex")};
    for(const command of roleSQL("create",secret))psql("postgres",command);
    for(const command of roleSQL("grants"))psql(
      command.includes("DATABASE protocolia")?"postgres":"protocolia",command);
    if(psql("postgres",roleSQL("nonlogin"))!=="2"||
       psql("protocolia",roleSQL("tableCheck"))!=="true")
      fail("External reader/writer privilege split or NOLOGIN state was not enforced");
    const record={schema:1,project:permit.project,permitSha256:permit.permitSha256,
      readerRole:reader,writerRole:writer,
      readerPassword:secret.reader,writerPassword:secret.writer};
    writeFileSync(opts.file,JSON.stringify(record,null,2)+"\n",{flag:"wx",mode:0o600});
    console.log("PROTOCOLIA_V11_EXTERNAL_ROLES_PREPARED "+JSON.stringify({
      project:permit.project,privilegedAppUserUnchanged:true,
      readerSelectOnly:true,writerDmlGranted:true,externalRolesNoLogin:true
    }));
    return {prepared:true};
  }
  const saved=readCredentials(opts.file,opts.approval,permit);
  if(mode==="blocked"){
    if(psql("postgres",roleSQL("login"))!=="0"||
       psql("postgres",roleSQL("nonlogin"))!=="2")
      fail("External roles must remain NOLOGIN in the cutover gap");
    if(docker([...base,"ps","--quiet","app"])!=="")
      fail("Old app resumed before new runtime was verified");
    const probe=docker([...base,"exec","-T","db","psql","-X","-U",writer,
      "-d","protocolia","-c","SELECT 1"],{allowFailure:true});
    if(probe.status===0||!/not permitted to log in/i.test(probe.stderr))
      fail("External writer login was not demonstrably blocked by PostgreSQL");
    if(original()!==opts.fence.dbId)fail("Original DB identity changed");
    console.log("PROTOCOLIA_V11_EXTERNAL_ROLES_BLOCKED "+JSON.stringify({
      project:permit.project,externalReaderNoLogin:true,externalWriterNoLogin:true,
      dbConnectionsReopened:true,oldAppStopped:true
    }));
    return {blocked:true};
  }
  // Health/image is required before allowing this test-only writer to log in.
  const postArgs=[opts.approval.dir,"--checkpoint",opts.approval.archive,
    "--report",opts.approval.report,"--receipt",opts.approval.receipt,
    "--candidate",opts.approval.candidate,"--project",opts.approval.project,
    "--env-file",opts.fence.env,"--health-url",opts.healthUrl];
  const observed=await verifyHealth(postArgs);
  if(observed.imageId!==permit.imageId||observed.dbContainerId!==opts.fence.dbId)
    fail("Post-start exact image or original DB identity not verified");
  if(psql("postgres",roleSQL("nonlogin"))!=="2")
    fail("Writer already enabled or role separation changed before health");
  if(psql("protocolia",roleSQL("tableCheck"))!=="true")
    fail("Writer/reader permission split was lost after migration");
  for(const statement of roleSQL("activate"))psql("postgres",statement);
  if(psql("postgres",roleSQL("login"))!=="2")fail("Could not enable reader/writer after health");
  const readerAttempt=docker([...base,"exec","-T","db","psql","-X","-U",reader,
    "-d","protocolia","-At","-c",
    "SELECT count(*) FROM public."+
      psql("protocolia",roleSQL("firstTable"))],{allowFailure:true});
  if(readerAttempt.status!==0)fail("Read-only external reader could not log in after verified health");
  const domainTable=psql("protocolia",roleSQL("firstTable"));
  if(!/^[a-z_][a-z0-9_]*$/.test(domainTable))
    fail("No safe TypeSpec-derived domain table for external privilege check");
  const firstColumn=psql("protocolia",
    "SELECT attname FROM pg_attribute WHERE attrelid=('public.'||'"+domainTable+
      "')::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum LIMIT 1");
  if(!/^[a-z_][a-z0-9_]*$/.test(firstColumn))
    fail("No safe generic column for denied UPDATE regression");
  const writeAttempt=docker([...base,"exec","-T","db","psql","-X","-U",reader,
    "-d","protocolia","-c",
    "UPDATE public."+domainTable+" SET "+firstColumn+"="+firstColumn+
      " WHERE false"],{allowFailure:true});
  if(writeAttempt.status===0||!/permission denied/i.test(writeAttempt.stderr))
    fail("Read-only role unexpectedly acquired table UPDATE permission");
  if(original()!==opts.fence.dbId)fail("DB container changed during role activation");
  console.log("PROTOCOLIA_V11_EXTERNAL_ROLES_ACTIVATED "+JSON.stringify({
    project:permit.project,pinnedRuntimeHealthy:true,
    readerCanSelect:true,readerWriteDenied:true,
    externalWriterReenabledAfterHealth:true
  }));
  return {activated:true};
}
