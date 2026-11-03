// Local-only Docker Compose runner. Tests always own an ephemeral Compose project/volume.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {checkedMakerGuardProof} from "../adapters/maker-checker-db-guard.mjs";
import {tenantStateDbProof} from "../adapters/tenant-state-policy.mjs";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

function execute(cmd,args,{cwd,env=process.env,quiet=false,timeout=300000}={}){
  const child=spawnSync(cmd,args,{cwd,env,encoding:"utf8",timeout,
    stdio:quiet?"pipe":"inherit"});
  if(child.error)throw Error(cmd+" unavailable: "+child.error.message);
  if(child.status!==0)throw Error(cmd+" exited "+child.status+
    (quiet?": "+(child.stderr||"").slice(-700):""));
  return child.stdout;
}
async function availablePort(){
  return await new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const port=server.address().port;
      server.close(error=>error?reject(error):resolve(port));
    });
  });
}
async function waitHealthy(base,timeoutMs){
  const deadline=Date.now()+timeoutMs;
  let latest="";
  while(Date.now()<deadline){
    try {
      const res=await fetch(base+"/health",{signal:AbortSignal.timeout(3000)});
      if(res.status===200)return;
      latest="HTTP "+res.status;
    }catch(e){latest=e.message;}
    await new Promise(resolve=>setTimeout(resolve,1400));
  }
  throw Error("Generated app did not reach /health: "+latest);
}
function checkOutput(folder){
  if(!existsSync(join(folder,"protocolia-build.json"))||
     !existsSync(join(folder,"compose.yaml")))
    throw Error("Expected a completed ProtocolIA generated app with JAR and Compose");
  const data=JSON.parse(readFileSync(join(folder,"protocolia-build.json"),"utf8"));
  if(![ "modular-spring","nestjs"].includes(data.target)||
    !["protocolia-cli-vnext-a2","protocolia-cli-vnext-a3"].includes(data.builder)||
    !existsSync(join(folder,data.target==="nestjs"?"dist/main.js":"target/modular-generated-0.0.1.jar")))
    throw Error("Unsupported output manifest; rebuild with ProtocolIA");
}
export async function composeAction(action,path){
  if(!["run","test"].includes(action)||!path)throw Error("Usage: protocolia <run|test> <generated-directory>");
  const out=resolve(path);
  checkOutput(out);
  // Do not use env-file credentials, secrets, or volume names supplied by other stacks.
  execute("docker",["compose","version"],{quiet:true,timeout:15000});
  if(action==="run"){
    // User owns the local .env and Compose project. This is intentionally foreground.
    console.log("PROTOCOLIA_LOCAL_RUN: bound to local loopback; demo auth requires explicit .env opt-in");
    execute("docker",["compose","up","--build"],{cwd:out,timeout:0});
    return;
  }
  // "test" never uses the consumer's .env, application database, or default Compose volume.
  const temporary=mkdtempSync(join(tmpdir(),"protocolia-compose-test-"));
  const testId=randomBytes(5).toString("hex");
  const project="protocolia_test_"+testId;
  const port=await availablePort();
  const readerName="test_reader", managerName="test_manager";
  const envFile=join(temporary,"test.env");
  const data={
    PROTOCOLIA_DB_PASSWORD:randomBytes(24).toString("hex"),
    PROTOCOLIA_ALLOW_DEMO_AUTH:"true",
    PROTOCOLIA_READER_USERNAME:readerName,
    PROTOCOLIA_READER_PASSWORD:randomBytes(24).toString("hex"),
    PROTOCOLIA_MANAGER_USERNAME:managerName,
    PROTOCOLIA_MANAGER_PASSWORD:randomBytes(24).toString("hex"),
    PROTOCOLIA_HOST_PORT:String(port),
  };
  // Opt-in isolated demo presenter for reviewed source-bounded submit/decide
  // profiles only. No credentials or grants from the consumer's .env are used.
  // The generated adapters still verify every operation's authoritative grant.
  const compiled=JSON.parse(readFileSync(join(out,"protocolia-contract-ir.json"),"utf8"));
  const stateOps=compiled.operations.filter(op=>op.behavior?.kind==="transition");
  const creator=compiled.operations.find(op=>op.behavior?.kind==="create");
  const getter=compiled.operations.find(op=>op.behavior?.kind==="get");
  const submits=stateOps.filter(op=>op.capability?.endsWith(".submit"));
  const decides=stateOps.filter(op=>op.capability?.endsWith(".decide")||
    op.capability?.endsWith(".decide.checked"));
  if(compiled.entities.length===1&&stateOps.length===3&&
    submits.length===1&&decides.length===2&&creator&&getter&&
    submits[0].entity===creator.entity&&
    decides.every(op=>op.entity===creator.entity)&&
    decides.every(op=>op.capability===decides[0].capability)&&
    submits[0].capability===creator.entity.toLowerCase()+".submit"&&
    [creator.entity.toLowerCase()+".decide",creator.entity.toLowerCase()+".decide.checked"]
      .includes(decides[0].capability)){
    data.PROTOCOLIA_SCOPED_USERNAME="test_submitter";
    data.PROTOCOLIA_SCOPED_PASSWORD=randomBytes(24).toString("hex");
    data.PROTOCOLIA_SCOPED_CAPABILITIES=
      getter.capability+","+submits[0].capability;
  }
  const tenantPrefix=creator?.entity?.toLowerCase();
  const tenantProfile=compiled.entities.length===1&&
    compiled.operations.length===7&&stateOps.length===3&&
    creator?.capability===tenantPrefix+".write.tenant"&&
    getter?.capability===tenantPrefix+".read.tenant"&&
    compiled.operations.every(op=>op.capability===(["get","listPage"].includes(op.behavior.kind)?
      tenantPrefix+".read.tenant":op.behavior.kind==="health"?"public":
      tenantPrefix+".write.tenant"));
  if(tenantProfile){
    // Equal business privileges, but verified demo identities bound to
    // different organizations. Never inferred from user-controlled headers.
    data.PROTOCOLIA_TEST_TENANT_MANAGER="org_alpha";
    data.PROTOCOLIA_TEST_TENANT_READER="org_alpha";
    data.PROTOCOLIA_TEST_TENANT_SCOPED="org_beta";
    data.PROTOCOLIA_SCOPED_USERNAME="test_tenant_peer";
    data.PROTOCOLIA_SCOPED_PASSWORD=randomBytes(24).toString("hex");
    data.PROTOCOLIA_SCOPED_CAPABILITIES=
      tenantPrefix+".read.tenant,"+tenantPrefix+".write.tenant";
  }
  writeFileSync(envFile,Object.entries(data).map(([k,v])=>k+"="+v).join("\n")+"\n",{mode:0o600});
  const compose=["compose","--project-name",project,"--env-file",envFile];
  const env={...process.env,...data};
  let started=false;
  try{
    execute("docker",[...compose,"config","--quiet"],{cwd:out,env,quiet:true});
    console.log("PROTOCOLIA_COMPOSE_CONFIG_PASS");
    started=true;
    execute("docker",[...compose,"up","--detach","--build"],{cwd:out,env,timeout:600000});
    const base="http://127.0.0.1:"+port;
    try{
      await waitHealthy(base,150000);
    }catch(e){
      execute("docker",[...compose,"logs","--tail","60","app"],{cwd:out,env,timeout:15000});
      throw e;
    }
    console.log("PROTOCOLIA_COMPOSE_HEALTH_PASS "+base);
    const processResult=spawnSync(process.execPath,[
      fileURLToPath(new URL("./conformance.mjs",import.meta.url)),out,base
    ],{
      cwd:out,env:{...env,PROTOCOLIA_ALLOW_CONFORMANCE_WRITES:"true"},
      stdio:"inherit",timeout:180000
    });
    if(processResult.error)throw processResult.error;
    if(processResult.status!==0)throw Error("HTTP conformance failed: "+processResult.status);
    console.log("PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS");
    // Direct SQL adversarial proof against the isolated Docker/PostgreSQL DB,
    // run only after a v0.5 HTTP conformance test has created a pending case.
    // The app and this psql process do NOT share session GUCs.
    const makerProof=checkedMakerGuardProof(compiled);
    const dbProof=makerProof??tenantStateDbProof(compiled);
    if(dbProof){
      const proof=spawnSync("docker",[
        ...compose,"exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
        "-U","protocolia","-d","protocolia"
      ],{cwd:out,env,encoding:"utf8",input:dbProof,timeout:60000});
      if(proof.error)throw proof.error;
      if(proof.status!==0)throw Error("Maker guard DB bypass proof FAILED: "+
        String(proof.stderr??"").slice(-1000));
      if(makerProof)console.log("PROTOCOLIA_MAKER_DB_GUARD_PASS "+
        JSON.stringify({table:compiled.entities[0].name,
          verified:["direct-finalization","maker-reassignment","state-rewind","maker-erasure"]}));
      else console.log("PROTOCOLIA_TENANT_DB_KEY_IMMUTABLE_PASS "+
        JSON.stringify({table:compiled.entities[0].name,verified:["tenant-reassignment"]}));
    }

  }finally{
    if(started){
      try{execute("docker",[...compose,"down","--volumes","--remove-orphans"],
        {cwd:out,env,timeout:120000});}
      catch(e){console.error("PROTOCOLIA_COMPOSE_CLEANUP_FAILED "+e.message);
        process.exitCode=1;}
    }
    rmSync(temporary,{force:true,recursive:true});
  }
}
