#!/usr/bin/env node
// Black-box temporal order oracle: generated HTTP PostgreSQL and mobile UI.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {readFileSync,mkdtempSync,rmSync,writeFileSync,existsSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
const generated=resolve(process.argv[2]??"");
assert.ok(process.argv[2],"Usage: probe-finite-choices-http.mjs generated-dir [--browser]");
const token=randomBytes(5).toString("hex"), project="date_oracle_"+token;
const work=mkdtempSync(join(tmpdir(),"protocolia-b1-date-order-"));
const manager="dates_manager",reader="dates_reader";
const pw=randomBytes(18).toString("hex"),rp=randomBytes(18).toString("hex");
const basic=(user,pass)=>"Basic "+Buffer.from(user+":"+pass).toString("base64");
const nestSchema=join(generated,"src/schema.sql");
const springSchema=join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql");
const schema=readFileSync(existsSync(nestSchema)?nestSchema:springSchema,"utf8");
assert.match(schema,/CHECK \(quality IN \('ready','needs_service','retired'\)\)|CHECK \(quality IN \('needs_service','ready','retired'\)\)/,
  "SQL must reject values outside the TypeSpec enum");
assert.ok(schema.includes("installed_at TIMESTAMP WITH TIME ZONE NOT NULL")&&
  schema.includes("CONSTRAINT ck_order_gauge_calibrated_at CHECK (calibrated_at IS NULL OR calibrated_at > installed_at)"),
  "PostgreSQL strict ordering constraint must be emitted by both generators");
assert.ok(schema.includes("CONSTRAINT ck_cond_gauge_maintenance_reason CHECK (")&&
  schema.includes("quality IS DISTINCT FROM 'needs_service'")&&
  schema.includes("maintenance_reason IS NOT NULL AND char_length(btrim(maintenance_reason)) > 0"),
  "Generated PostgreSQL must independently require maintenance reason for needs_service");
assert.ok(schema.includes("CONSTRAINT ck_gt_gauge_reading_ceiling CHECK (reading_ceiling IS NULL OR reading_ceiling > reading)"),
  "PostgreSQL must independently enforce the optional numeric ceiling");
function docker(args,timeout=600000){
 const r=spawnSync("docker",args,{cwd:generated,encoding:"utf8",timeout});
 if(r.status!==0||r.error)throw Error("docker "+args.join(" ")+" failed "+(r.stderr??r.error?.message??"").slice(-1600));
 return r.stdout;
}
async function freePort(){return new Promise((ok,no)=>{
 const s=createServer();s.once("error",no);s.listen(0,"127.0.0.1",()=>{
 const p=s.address().port;s.close(()=>ok(p));});
});}
let args=[],started=false;
try{
 const port=await freePort(),env=join(work,"env");
 writeFileSync(env,[
  "PROTOCOLIA_DB_PASSWORD="+randomBytes(20).toString("hex"),
  "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
  "PROTOCOLIA_MANAGER_USERNAME="+manager,
  "PROTOCOLIA_MANAGER_PASSWORD="+pw,
  "PROTOCOLIA_READER_USERNAME="+reader,
  "PROTOCOLIA_READER_PASSWORD="+rp,
  "PROTOCOLIA_HOST_PORT="+port
 ].join("\n")+"\n",{mode:0o600});
 args=["compose","--project-name",project,"--env-file",env];
 docker([...args,"config","--quiet"],15000);started=true;
 docker([...args,"up","--detach","--build"]);
 const base="http://127.0.0.1:"+port,end=Date.now()+150000;
 let ready=false;
 while(Date.now()<end){
  try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(2000)})).status===200){ready=true;break;}}catch{}
  await new Promise(ok=>setTimeout(ok,1000));
 }
 assert.ok(ready,"Generated app health");
 async function req(path,{method="GET",body,who="manager"}={}){
  const response=await fetch(base+path,{method,headers:{
   ...(who==="manager"?{Authorization:basic(manager,pw)}:who==="reader"?{Authorization:basic(reader,rp)}:{}),
   ...(body===undefined?{}:{"Content-Type":"application/json"})},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(13000)});
  const raw=await response.text();let json;try{json=JSON.parse(raw)}catch{json=raw}
  return {status:response.status,body:json};
 }
 const path="/api/gauges",payload={serial:token+"-one",label:"Medidor ficticio",reading:2,quality:"ready",installedAt:"2026-10-15T12:00:00Z"};
 assert.equal((await req(path,{who:null})).status,401);
 assert.equal((await req(path,{method:"POST",body:payload,who:"reader"})).status,403);
 for(const [bad,code] of [["unknown","invalid_choice"],[17,"invalid_type"],["READY","invalid_choice"]]){
  const result=await req(path,{method:"POST",body:{...payload,quality:bad}});
  assert.equal(result.status,400,JSON.stringify(result.body));
  assert.deepEqual(result.body.issues,[{field:"quality",code}],"Consistent Nest/Spring typed enum rejection");
 }
 assert.equal((await req(path+"/"+payload.serial)).status,404,"Invalid values cannot persist");
 // Independent of HTTP code: bypass the app and prove PostgreSQL itself refuses an enum breach.
 const dbIdentity=token+"-invalid-direct";
 const sql="INSERT INTO gauge(serial,label,reading,quality,installed_at) VALUES ('"+
   dbIdentity+"','Direct PostgreSQL invariant probe',1,'unlisted_value','2026-10-15T12:00:00Z')";
 const direct=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",sql],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(direct.status,0,"PostgreSQL must independently refuse undeclared enum values");
 assert.match((direct.stderr??"")+(direct.stdout??""),/violates check constraint/i,
   "Negative DB mutation must specifically fail its enum CHECK constraint");
 assert.equal((await req(path+"/"+dbIdentity)).status,404,"Invalid direct SQL insert rolled back");
 const incomplete=token+"-invalid-condition";
 const conditionalSql="INSERT INTO gauge(serial,label,reading,quality,installed_at) VALUES ('"+
   incomplete+"','Conditional SQL check',1,'needs_service','2026-10-15T12:00:00Z')";
 const rejected=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",conditionalSql],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(rejected.status,0,"PostgreSQL must reject missing conditional field");
 assert.match((rejected.stderr??"")+(rejected.stdout??""),/ck_cond_gauge_maintenance_reason/i);
 assert.equal((await req(path+"/"+incomplete)).status,404,"Conditional SQL breach is rolled back");
 for(const [reason,serial] of [[undefined,"absent"],["","empty"],["   ","spaces"]]){
   const input={...payload,serial:token+"-"+serial,quality:"needs_service"};
   if(reason!==undefined)input.maintenanceReason=reason;
   const response=await req(path,{method:"POST",body:input});
   assert.equal(response.status,400,"Conditional reason must fail before persistence");
   assert.deepEqual(response.body?.issues,[{field:"maintenanceReason",code:"required"}]);
   assert.equal((await req(path+"/"+input.serial)).status,404);
 }
 for(const [ceiling,code,i] of [[2,"invalid_comparison",1],[1,"invalid_comparison",2],[null,"required",3],["3","invalid_type",4]]){
   const candidate={...payload,serial:token+"-bad-ceiling-"+i,readingCeiling:ceiling};
   const response=await req(path,{method:"POST",body:candidate});
   assert.equal(response.status,400,JSON.stringify(response.body));
   assert.deepEqual(response.body.issues,[{field:"readingCeiling",code}]);
   assert.equal((await req(path+"/"+candidate.serial)).status,404);
 }
 const validCeiling={...payload,serial:token+"-valid-ceiling",readingCeiling:3};
 assert.equal((await req(path,{method:"POST",body:validCeiling})).status,201);
 assert.equal((await req(path+"/"+validCeiling.serial)).body.readingCeiling,3);
 const directCeiling=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",
   "INSERT INTO gauge(serial,label,reading,reading_ceiling,installed_at) VALUES ('"+
     token+"-direct-ceiling','Direct numeric comparison',2,2,'2026-10-15T12:00:00Z')"],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(directCeiling.status,0,"SQL cannot bypass the numerical field constraint");
 assert.match((directCeiling.stderr??"")+(directCeiling.stdout??""),/ck_gt_gauge_reading_ceiling/i);
 assert.equal((await req(path+"/"+token+"-direct-ceiling")).status,404);
 const serviced={...payload,serial:token+"-serviced",quality:"needs_service",
   maintenanceReason:"Pérdida de calibración verificada"};
 assert.equal((await req(path,{method:"POST",body:serviced})).status,201);
 assert.equal((await req(path+"/"+serviced.serial)).body.maintenanceReason,serviced.maintenanceReason);
 const retired={...payload,serial:token+"-retired",quality:"retired"};
 assert.equal((await req(path,{method:"POST",body:retired})).status,201,
   "Other enum values must not require the conditional field");
 const valid={...payload,serial:token+"-later",calibratedAt:"2026-10-15T08:00:01-04:00"};
 assert.equal((await req(path,{method:"POST",body:valid})).status,201,
   "Timezone-offset timestamp after source must be accepted");
 const readLater=(await req(path+"/"+valid.serial)).body;
 assert.equal(Date.parse(readLater.calibratedAt),Date.parse(valid.calibratedAt));
 for(const [end,code,i] of [
   ["2026-10-15T12:00:00Z","invalid_order",1],
   ["2026-10-15T08:00:00-04:00","invalid_order",2],
   ["2026-10-15T11:59:59Z","invalid_order",3],
   ["2026-10-15T12:00:00.000001Z","invalid_format",4]
 ]){
   const invalid={...payload,serial:token+"-bad-"+i,calibratedAt:end};
   const result=await req(path,{method:"POST",body:invalid});
   assert.equal(result.status,400,JSON.stringify({end,result}));
   assert.deepEqual(result.body.issues,[{field:"calibratedAt",code}]);
 }
 const rawOrder="INSERT INTO gauge(serial,label,reading,quality,installed_at,calibrated_at) VALUES ('"+
   token+"-direct-order','Direct order invalid',1,'ready','2026-10-15T12:00:00Z','2026-10-15T11:59:59Z')";
 const directOrder=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",rawOrder],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(directOrder.status,0,"Direct SQL cannot bypass temporal ordering");
 assert.match((directOrder.stderr??"")+(directOrder.stdout??""),/ck_order_gauge_calibrated_at/i);
 assert.equal((await req(path+"/"+token+"-direct-order")).status,404);
 assert.equal((await req(path,{method:"POST",body:payload})).status,201);
 assert.equal((await req(path+"/"+payload.serial,{who:"reader"})).body.quality,"ready");
 assert.equal((await req(path,{method:"POST",body:{serial:token+"-no-choice",label:"Opcional",reading:0,installedAt:"2026-10-15T12:00:00Z"}})).status,201);
 assert.equal((await req(path,{method:"POST",body:payload})).status,409);
 if(process.argv.includes("--browser")){
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
   const page=await browser.newPage({viewport:{width:390,height:780},locale:"es-AR"});
   const errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.goto(base+"/",{waitUntil:"domcontentloaded"});
   await page.getByTestId("username").fill(manager);
   await page.getByTestId("password").fill(pw);
   await page.getByRole("button",{name:"Entrar",exact:true}).click();
   await page.getByTestId("open-create").click();
   const form=page.getByTestId("create-form-Gauge");
   await form.waitFor({state:"visible"});
   const selected=token+"-web";
   await form.getByTestId("create-serial").fill(selected);
   await form.getByTestId("create-label").fill("Instrumento generado");
   await form.getByTestId("create-reading").fill("3");
   assert.equal(await form.getByTestId("create-readingCeiling").inputValue(),"",
     "Optional int32 must start empty, not zero");
   await form.getByTestId("create-readingCeiling").fill("3");
   await form.getByTestId("create-installedAt").fill("2026-10-15T12:00:00Z");
   await form.getByTestId("create-calibratedAt").fill("2026-10-15T12:00:00Z");
   await form.getByRole("button",{name:"Crear",exact:true}).click();
   assert.equal(await form.getByTestId("create-calibratedAt").getAttribute("aria-invalid"),"true",
     "Mobile frontend must reject equal instants");
   assert.equal(await form.getByTestId("create-readingCeiling").getAttribute("aria-invalid"),"true",
     "Mobile frontend must highlight invalid number comparison");
   await form.getByTestId("create-quality").click();
   await page.getByRole("option",{name:"Needs Service"}).click();
   await form.getByRole("button",{name:"Crear",exact:true}).click();
   assert.equal(await page.getByTestId("create-dialog").isVisible(),true,
     "A missing conditional reason must not close the create form");
   assert.equal(await form.getByTestId("create-maintenanceReason").getAttribute("aria-invalid"),"true",
     "The generated UI identifies the conditional field before API write");
   const requiredLabel=await form.getByTestId("create-maintenanceReason").locator("..").innerText();
   assert.match(requiredLabel,/obligatorio/i,"Mobile form explains the conditional requirement");
   await form.getByTestId("create-maintenanceReason").fill("Falla en la calibración de prueba");
   await form.getByTestId("create-calibratedAt").fill("2026-10-15T12:05:00Z");
   await form.getByTestId("create-readingCeiling").fill("4");
   await page.screenshot({path:join(generated,"protocolia-b1-enum-mobile.png"),fullPage:true});
   await form.getByRole("button",{name:"Crear",exact:true}).click();
   await page.getByTestId("create-dialog").waitFor({state:"hidden",timeout:15000});
   const stored=await req(path+"/"+selected);
   assert.equal(stored.body.quality,"needs_service","UI persists source enum value, not caption");
   assert.equal(stored.body.maintenanceReason,"Falla en la calibración de prueba");
   assert.equal(stored.body.readingCeiling,4);
   assert.equal(Date.parse(stored.body.calibratedAt),Date.parse("2026-10-15T12:05:00Z"));
   assert.equal(errors.length,0,"React errors: "+errors.join(";"));
   console.log("PROTOCOLIA_B1_DATE_ORDER_BROWSER_PASS "+JSON.stringify({choice:"needs_service",conditionalRequired:true,mobile:true,jsErrors:0}));
  }finally{await browser.close();}
 }
 docker([...args,"restart","app"],120000);
 const after=Date.now()+80000;let returned=false;
 while(Date.now()<after){
  try{if((await req(path+"/"+payload.serial)).body.quality==="ready"){returned=true;break;}}catch{}
  await new Promise(ok=>setTimeout(ok,1000));
 }
 assert.ok(returned,"PostgreSQL value persisted across restart");
 console.log("PROTOCOLIA_B1_DATE_ORDER_HTTP_PASS "+JSON.stringify({source:"TypeSpec native enum",invalidChoice400:true,postgresConstraint:true,conditionalRequired:true,dbRejectsIncomplete:true,persisted:true}));
}finally{
 if(started)try{docker([...args,"down","--volumes","--remove-orphans"],120000)}
 catch(e){console.error("B1 cleanup failed",e.message);process.exitCode=1}
 rmSync(work,{recursive:true,force:true});
}
