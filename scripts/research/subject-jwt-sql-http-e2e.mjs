#!/usr/bin/env node
// S2.1 disposable JWT+Postgres E2E. Four verified people, four independent SQL
// logins, two tenants, source-generated NestJS or Spring. Never touches remote DB.
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes,sign} from "node:crypto";
import {spawnSync} from "node:child_process";
import {createServer as httpServer} from "node:http";
import {createServer as netServer} from "node:net";
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

assert.equal(process.env.PROTOCOLIA_ALLOW_DISPOSABLE_DB_TEST,"true",
  "Refuse S2 human test without isolated disposable opt-in");
const app=resolve(process.argv[2]??"");
const target=process.argv[3];
assert.ok(process.argv[2]&&["nestjs","modular-spring"].includes(target),
  "Usage: subject-jwt-sql-http-e2e.mjs GENERATED_APP nestjs|modular-spring");
const baseline=readFileSync(join(app,target==="nestjs"?"src/schema.sql":
  "src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
const s1=readFileSync(join(app,"protocolia-tenant-rls-role-candidate.sql"),"utf8");
const s2=readFileSync(join(app,"protocolia-subject-role-guard-candidate.sql"),"utf8");
const config=JSON.parse(readFileSync(join(app,target==="nestjs"?
  "dist/static/protocolia-ui.json":"src/main/resources/static/protocolia-ui.json"),"utf8"));
assert.equal(config.entity.name,"ServiceTicket");
const resource=config.resources?.[0]??{entity:config.entity,operations:config.operations,
  transitions:config.transitions};
const transitions=resource.transitions??[];
const statusField=resource.entity.fields.find(f=>f.name==="phase");
const root=transitions.find(o=>o.behavior.from===statusField.initial);
const decisions=transitions.filter(o=>o.behavior.from===root?.behavior.to);
assert.ok(root&&decisions.length===2);
const project="p_s21_"+randomBytes(5).toString("hex"),temp=mkdtempSync(join(tmpdir(),"p-s21-"));
const rand=()=>randomBytes(24).toString("hex");
const passwords={admin:rand(),owner:rand(),alpha:rand(),beta:rand(),ac:rand(),bc:rand()};
const roles=[
  {tenant:"org_alpha",subject:"alpha-maker",user:"protocolia_rls_alpha",password:passwords.alpha},
  {tenant:"org_alpha",subject:"alpha-checker",user:"protocolia_s2_alpha_checker",password:passwords.ac},
  {tenant:"org_beta",subject:"beta-maker",user:"protocolia_rls_beta",password:passwords.beta},
  {tenant:"org_beta",subject:"beta-checker",user:"protocolia_s2_beta_checker",password:passwords.bc}
];
const handoff=randomBytes(32).toString("hex");
const issuer="https://issuer.protocolia.test",audience="protocolia-s2-generated-api";
const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const publicJwk={...publicKey.export({format:"jwk"}),kid:"p-s2-disposable",alg:"RS256",use:"sig"};
const b64=value=>Buffer.from(typeof value==="string"?value:JSON.stringify(value)).toString("base64url");
const caps=["serviceticket.read.tenant","serviceticket.write.tenant",
  "serviceticket.submit","serviceticket.decide.checked"];
function token(subject,tenant,override={}){
  const now=Math.floor(Date.now()/1000);
  const header={alg:"RS256",typ:"JWT",kid:publicJwk.kid};
  const payload={iss:issuer,aud:audience,sub:subject,protocolia_tenant:tenant,
    iat:now,nbf:now-5,exp:now+1200,protocolia_capabilities:caps,...override};
  const wire=b64(header)+"."+b64(payload);
  return wire+"."+sign("RSA-SHA256",Buffer.from(wire),privateKey).toString("base64url");
}
async function port(){
  return await new Promise((ok,fail)=>{
    const s=netServer();s.once("error",fail);
    s.listen(0,"127.0.0.1",()=>{const n=s.address().port;s.close(()=>ok(n));});
  });
}
let server,compose=[],dockerReady=false;
function docker(args,{input="",timeout=200000}={}){
  const r=spawnSync("docker",args,{cwd:app,encoding:"utf8",input,timeout,maxBuffer:8*1024*1024});
  if(r.status!==0||r.error)
    throw Error("Disposable Docker command failed: "+args.filter(v=>!v.includes("PASSWORD")).join(" ")+
      "\n"+String(r.stderr??r.error?.message).slice(-2600));
  return r.stdout;
}
const run=(args,opts={})=>docker([...compose,...args],opts);
function psqlAs(user,password,sql){
  const opts=["exec","-T",...(user==="protocolia"?[]:["-e","PGPASSWORD="+password]),
    "db","psql","-X",...(user==="protocolia"?[]:["-h","127.0.0.1"]),
    "-U",user,"-d","protocolia","-v","ON_ERROR_STOP=1","-q"];
  return run(opts,{input:sql,timeout:45000});
}
async function waitReady(url,limit=110000){
  const end=Date.now()+limit;
  while(Date.now()<end){
    try{if((await fetch(url,{signal:AbortSignal.timeout(2000)})).status===200)return true;}
    catch{}
    await new Promise(ok=>setTimeout(ok,800));
  }
  return false;
}
function route(op,key){
  return op.path.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,encodeURIComponent(key??""));
}
async function request(op,who,{key,body,header={}}={}){
  const auth=typeof who==="string"?who:token(who.subject,who.tenant);
  const response=await fetch(base+route(op,key),{method:op.method,
    headers:{Authorization:"Bearer "+auth,...(body?{"Content-Type":"application/json"}:{}),...header},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const raw=await response.text();
  let data;try{data=JSON.parse(raw)}catch{data=raw}
  return {status:response.status,data};
}
let base;
try{
  const [appPort,jwkPort]=await Promise.all([port(),port()]);
  base="http://127.0.0.1:"+appPort;
  server=httpServer((req,res)=>{
    if(req.url!=="/jwks"){res.writeHead(404);res.end();return;}
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({keys:[publicJwk]}));
  });
  await new Promise((ok,fail)=>server.once("error",fail).listen(jwkPort,"0.0.0.0",ok));
  const env=join(temp,"config.env"),extra=join(temp,"overlay.yaml");
  const envLines=[
    "PROTOCOLIA_DB_PASSWORD="+passwords.admin,
    "PROTOCOLIA_RUNTIME_DB_USER=protocolia_rls_alpha",
    "PROTOCOLIA_RUNTIME_DB_PASSWORD="+passwords.alpha,
    "PROTOCOLIA_MIGRATION_DB_USER=",
    "PROTOCOLIA_MIGRATION_DB_PASSWORD=",
    "PROTOCOLIA_TENANT_SQL_ROUTING=human-jwt-v1",
    "PROTOCOLIA_S2_HUMAN_SQL_BINDINGS_JSON='"+JSON.stringify(roles)+"'",
    "PROTOCOLIA_EXECUTION_MODE=runtime",
    "PROTOCOLIA_MIGRATION_HANDOFF_ID="+handoff,
    "PROTOCOLIA_HOST_PORT="+appPort,
    "PROTOCOLIA_AUTH_MODE=jwt",
    "PROTOCOLIA_ALLOW_DEMO_AUTH=false",
    "PROTOCOLIA_JWT_ISSUER="+issuer,
    "PROTOCOLIA_JWT_AUDIENCE="+audience,
    "PROTOCOLIA_JWT_JWKS_URI=http://host.docker.internal:"+jwkPort+"/jwks",
    "PROTOCOLIA_JWT_ALLOW_TEST_HTTP=true",
    "PROTOCOLIA_READER_USERNAME=test_only_reader",
    "PROTOCOLIA_READER_PASSWORD="+rand(),
    "PROTOCOLIA_MANAGER_USERNAME=test_only_manager",
    "PROTOCOLIA_MANAGER_PASSWORD="+rand()
  ];
  writeFileSync(env,envLines.join("\n")+"\n",{mode:0o600});
  writeFileSync(extra,'services:\n  app:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n');
  compose=["compose","-f",join(app,"compose.yaml"),"-f",extra,
    "--project-name",project,"--env-file",env];
  run(["config","--quiet"],{timeout:15000});
  dockerReady=true;
  run(["up","--detach","db"],{timeout:150000});
  let ready=false;
  for(let i=0;i<70;i++){
    const r=spawnSync("docker",[...compose,"exec","-T","db","pg_isready",
      "-h","127.0.0.1","-U","protocolia","-d","protocolia","-q"],{cwd:app,timeout:8000});
    if(r.status===0){ready=true;break;}
    await new Promise(ok=>setTimeout(ok,600));
  }
  assert.ok(ready,"Disposable S2 PostgreSQL did not start TCP");
  psqlAs("protocolia","",[
    "REVOKE CREATE ON SCHEMA public FROM PUBLIC;",
    "CREATE ROLE protocolia_rls_owner LOGIN NOINHERIT PASSWORD '"+passwords.owner+"';",
    "CREATE ROLE protocolia_rls_alpha LOGIN NOINHERIT PASSWORD '"+passwords.alpha+"';",
    "CREATE ROLE protocolia_rls_beta LOGIN NOINHERIT PASSWORD '"+passwords.beta+"';",
    "CREATE ROLE protocolia_s2_alpha_checker LOGIN NOINHERIT PASSWORD '"+passwords.ac+"';",
    "CREATE ROLE protocolia_s2_beta_checker LOGIN NOINHERIT PASSWORD '"+passwords.bc+"';",
    "ALTER SCHEMA public OWNER TO protocolia_rls_owner;"
  ].join("\n"));
  psqlAs("protocolia_rls_owner",passwords.owner,baseline);
  psqlAs("protocolia_rls_owner",passwords.owner,
    ["BEGIN;",
     "SET LOCAL protocolia.rls_role_alpha='protocolia_rls_alpha';",
     "SET LOCAL protocolia.rls_role_beta='protocolia_rls_beta';",
     s1,
     "INSERT INTO public.protocolia_rls_principal_tenant(principal,tenant_id) VALUES",
     "('protocolia_rls_alpha','org_alpha'),('protocolia_rls_beta','org_beta');",
     "COMMIT;"].join("\n"));
  psqlAs("protocolia_rls_owner",passwords.owner,
    ["BEGIN;",
     "SET LOCAL protocolia.s2_alpha_checker='protocolia_s2_alpha_checker';",
     "SET LOCAL protocolia.s2_beta_checker='protocolia_s2_beta_checker';",
     "SET LOCAL protocolia.s2_alpha_maker_subject='alpha-maker';",
     "SET LOCAL protocolia.s2_alpha_checker_subject='alpha-checker';",
     "SET LOCAL protocolia.s2_beta_maker_subject='beta-maker';",
     "SET LOCAL protocolia.s2_beta_checker_subject='beta-checker';",
     s2,"COMMIT;"].join("\n"));
  psqlAs("protocolia_rls_owner",passwords.owner,
    "CREATE TABLE public.protocolia_migration_handoff_v1 ("+
    "image_digest varchar(64) PRIMARY KEY,completed_at timestamptz DEFAULT now());"+
    "INSERT INTO public.protocolia_migration_handoff_v1(image_digest) VALUES ('"+handoff+"');"+
    "GRANT SELECT ON public.protocolia_migration_handoff_v1 TO protocolia_rls_alpha;");
  // A staged app may not serve HTTP with either database identity trigger
  // disabled. The two failures must be explicit and independent, not a
  // connectivity timeout or a missing JWT/role.
  run(["build","app"],{timeout:220000});
  async function proveTriggerGuardDisabled(label,table,trigger){
    psqlAs("protocolia_rls_owner",passwords.owner,
      "ALTER TABLE public."+table+" DISABLE TRIGGER "+trigger+";");
    run(["up","--detach","--no-deps","--force-recreate","app"],{timeout:45000});
    let rejected=false;
    for(let attempt=0;attempt<65;attempt++){
      const logs=run(["logs","--no-color","--tail","110","app"],{timeout:15000});
      if(/S2 human SQL connection\/subject\/RLS authority preflight failed|S2 human SQL routing refused unsafe DB identity/.test(logs)){
        rejected=true;
        break;
      }
      try{
        const res=await fetch(base+"/health",{signal:AbortSignal.timeout(800)});
        if(res.status===200)throw Error("UNSAFE S2 startup accepted disabled "+label+" trigger");
      }catch(error){
        if(String(error).includes("UNSAFE S2"))throw error;
      }
      await new Promise(ok=>setTimeout(ok,500));
    }
    assert.ok(rejected,"S2 did not explicitly refuse disabled "+label+" trigger");
    run(["stop","app"],{timeout:25000});
    psqlAs("protocolia_rls_owner",passwords.owner,
      "ALTER TABLE public."+table+" ENABLE TRIGGER "+trigger+";");
    console.log("PROTOCOLIA_S2_HUMAN_SQL_STARTUP_REJECTED_PASS "+target+" "+label);
  }
  await proveTriggerGuardDisabled("maker","service_ticket",
    "protocolia_s2_human_service_ticket_trigger");
  await proveTriggerGuardDisabled("audit","protocolia_audit_event",
    "protocolia_s2_audit_actor_trigger");
  run(["up","--detach","--no-deps","--force-recreate","app"],{timeout:45000});
  assert.ok(await waitReady(base+"/health"),"S2 generated JWT app rejected correct SQL principal mapping");
  const a=roles[0],ac=roles[1],b=roles[2],bc=roles[3];
  const create=resource.operations.create,get=resource.operations.get,
    list=resource.operations.listPage,decision1=decisions[0],decision2=decisions[1];
  assert.ok(create&&get&&list);
  const keyA="S2Alpha"+randomBytes(5).toString("hex"),
    keyB="S2Beta"+randomBytes(5).toString("hex");
  const id=resource.entity.publicIdentity;
  const createBody=(key)=>({[id]:key,description:"Signed human JWT SQL authority proof"});
  const createdA=await request(create,a,{body:createBody(keyA)});
  assert.equal(createdA.status,201,JSON.stringify(createdA));
  assert.equal((await request(get,b,{key:keyA})).status,404);
  assert.equal((await request(root,a,{key:keyA})).status,200);
  assert.equal((await request(decision1,a,{key:keyA})).status,403);
  const results=await Promise.all(Array.from({length:8},()=>
    request(decision1,ac,{key:keyA})));
  assert.equal(results.filter(x=>x.status===200).length,1);
  assert.equal(results.filter(x=>x.status===409).length,7);
  assert.equal((await request(get,ac,{key:keyA})).data.phase,decision1.behavior.to);
  const createdB=await request(create,b,{body:createBody(keyB)});
  assert.equal(createdB.status,201,JSON.stringify(createdB));
  assert.equal((await request(get,a,{key:keyB})).status,404);
  assert.equal((await request(root,b,{key:keyB})).status,200);
  assert.equal((await request(decision2,b,{key:keyB})).status,403);
  assert.equal((await request(decision2,bc,{key:keyB})).status,200);
  assert.equal((await request(get,bc,{key:keyB})).data.phase,decision2.behavior.to);
  const fakeHeader=await request(get,b,{key:keyA,header:{"X-ProtocolIA-Tenant":"org_alpha"}});
  assert.equal(fakeHeader.status,404);
  const alien=await request(get,token("unknown-identity","org_alpha"),{key:keyA});
  assert.equal(alien.status,403);
  const wrongTenant=await request(get,token("alpha-maker","org_beta"),{key:keyA});
  assert.equal(wrongTenant.status,403);
  const expired=await request(get,token("alpha-maker","org_alpha",
    {exp:Math.floor(Date.now()/1000)-200}),{key:keyA});
  assert.equal(expired.status,401);
  const pageA=await request(list,a),pageB=await request(list,b);
  assert.equal(pageA.status,200);assert.equal(pageB.status,200);
  assert.equal(pageA.data.total,1);assert.equal(pageB.data.total,1);
  psqlAs("protocolia","",[
    "DO $check$ DECLARE n integer; BEGIN",
    "SELECT count(*) INTO n FROM public.protocolia_audit_event;",
    "IF n<4 OR (SELECT count(DISTINCT actor) FROM public.protocolia_audit_event)<4 OR",
    "   (SELECT count(DISTINCT protocolia_tenant_id) FROM public.protocolia_audit_event)<>2 THEN",
    "RAISE EXCEPTION 'S2 HTTP audit subject and tenant provenance failed'; END IF;",
    "END $check$;"
  ].join("\n"));
  console.log("PROTOCOLIA_S2_JWT_HUMAN_SQL_HTTP_PASS "+JSON.stringify({
    target,tenants:2,authenticatedHumans:4,independentAlphaChecker:true,
    independentBetaChecker:true,selfApprovalDenied:true,crossTenantDenied:true,
    forgedHeaderDenied:true,unknownSubjectDenied:true,unknownBindingDenied:true,
    expiredJWTDenied:true,concurrentConflicts:7,auditActorCount:4
  }));
}catch(error){
  if(dockerReady)try{
    const wire=run(["logs","--no-color","--tail","160","app"],{timeout:15000});
    let safe=wire;
    for(const secret of [...Object.values(passwords),handoff])
      safe=safe.replaceAll(secret,"[REDACTED]");
    console.error("S2 JWT "+target+" app startup/runtime diagnostics:",safe.slice(-12000));
  }catch(logError){
    console.error("Unable to read disposable S2 app diagnostics",String(logError).slice(0,200));
  }
  throw error;
}finally{
  if(dockerReady)try{run(["down","--volumes","--remove-orphans"],{timeout:120000});}
  catch(e){console.error("Disposable S2 teardown failed",String(e).slice(0,150));process.exitCode=1;}
  if(server)await new Promise(ok=>server.close(ok));
  rmSync(temp,{recursive:true,force:true});
}
