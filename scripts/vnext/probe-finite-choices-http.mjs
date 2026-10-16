#!/usr/bin/env node
// Black-box acceptance: original native TypeSpec enum, not runtime-manifest mock.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
const generated=resolve(process.argv[2]??"");
assert.ok(process.argv[2],"Usage: probe-finite-choices-http.mjs generated-dir [--browser]");
const token=randomBytes(5).toString("hex"), project="enum_oracle_"+token;
const work=mkdtempSync(join(tmpdir(),"protocolia-b1-enum-"));
const manager="enum_manager",reader="enum_reader";
const pw=randomBytes(18).toString("hex"),rp=randomBytes(18).toString("hex");
const basic=(user,pass)=>"Basic "+Buffer.from(user+":"+pass).toString("base64");
const schema=readFileSync(join(generated,"src/schema.sql"),"utf8");
assert.match(schema,/CHECK \(quality IN \('ready','needs_service','retired'\)\)|CHECK \(quality IN \('needs_service','ready','retired'\)\)/,
  "SQL must reject values outside the TypeSpec enum");
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
 const path="/api/gauges",payload={serial:token+"-one",label:"Medidor ficticio",reading:2,quality:"ready"};
 assert.equal((await req(path,{who:null})).status,401);
 assert.equal((await req(path,{method:"POST",body:payload,who:"reader"})).status,403);
 for(const [bad,code] of [["unknown","invalid_choice"],[17,"invalid_type"],["READY","invalid_choice"]]){
  const result=await req(path,{method:"POST",body:{...payload,quality:bad}});
  assert.equal(result.status,400,JSON.stringify(result.body));
  assert.deepEqual(result.body.issues,[{field:"quality",code}],"Consistent Nest/Spring typed enum rejection");
 }
 assert.equal((await req(path+"/"+payload.serial)).status,404,"Invalid values cannot persist");
 assert.equal((await req(path,{method:"POST",body:payload})).status,201);
 assert.equal((await req(path+"/"+payload.serial,{who:"reader"})).body.quality,"ready");
 assert.equal((await req(path,{method:"POST",body:{serial:token+"-no-choice",label:"Opcional",reading:0}})).status,201);
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
   await form.getByTestId("create-quality").click();
   await page.getByRole("option",{name:"Needs Service"}).click();
   await page.screenshot({path:join(generated,"protocolia-b1-enum-mobile.png"),fullPage:true});
   await form.getByRole("button",{name:"Crear",exact:true}).click();
   await page.getByTestId("create-dialog").waitFor({state:"hidden",timeout:15000});
   assert.equal((await req(path+"/"+selected)).body.quality,"needs_service","UI persists source enum value, not caption");
   assert.equal(errors.length,0,"React errors: "+errors.join(";"));
   console.log("PROTOCOLIA_B1_ENUM_BROWSER_PASS "+JSON.stringify({choice:"needs_service",mobile:true,jsErrors:0}));
  }finally{await browser.close();}
 }
 docker([...args,"restart","app"],120000);
 const after=Date.now()+80000;let returned=false;
 while(Date.now()<after){
  try{if((await req(path+"/"+payload.serial)).body.quality==="ready"){returned=true;break;}}catch{}
  await new Promise(ok=>setTimeout(ok,1000));
 }
 assert.ok(returned,"PostgreSQL value persisted across restart");
 console.log("PROTOCOLIA_B1_ENUM_HTTP_PASS "+JSON.stringify({source:"TypeSpec native enum",invalidChoice400:true,postgresConstraint:true,persisted:true}));
}finally{
 if(started)try{docker([...args,"down","--volumes","--remove-orphans"],120000)}
 catch(e){console.error("B1 cleanup failed",e.message);process.exitCode=1}
 rmSync(work,{recursive:true,force:true});
}
