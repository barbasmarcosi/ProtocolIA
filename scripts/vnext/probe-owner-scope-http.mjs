#!/usr/bin/env node
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {readFileSync,mkdtempSync,rmSync,writeFileSync,existsSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";

const generated=resolve(process.argv[2]??"");
assert.ok(process.argv[2],"Provide generated app directory");
const token=randomBytes(5).toString("hex"),project="s1a_owner_"+token;
const work=mkdtempSync(join(tmpdir(),"protocolia-s1-owner-"));
const manager="scope_manager",reader="scope_reader";
const pw=randomBytes(18).toString("hex"),rp=randomBytes(18).toString("hex");
const basic=(u,p)=>"Basic "+Buffer.from(u+":"+p).toString("base64");
const schemaPath=join(generated,"src/schema.sql");
const migrationPath=join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql");
const schema=readFileSync(existsSync(schemaPath)?schemaPath:migrationPath,"utf8");
assert.match(schema,/owner VARCHAR\(128\).*NOT NULL/i);
function docker(args,timeout=600000){
 const r=spawnSync("docker",args,{cwd:generated,encoding:"utf8",timeout});
 if(r.status!==0||r.error)throw Error("docker "+args.join(" ")+" failed "+(r.stderr??r.error?.message??"").slice(-1500));
 return r.stdout;
}
async function port(){return new Promise((resolve,reject)=>{
 const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{
  const p=server.address().port;server.close(()=>resolve(p));
 });
});}
let args=[],started=false;
try{
 const hostPort=await port(),env=join(work,"env");
 writeFileSync(env,[
  "PROTOCOLIA_DB_PASSWORD="+randomBytes(20).toString("hex"),
  "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
  "PROTOCOLIA_MANAGER_USERNAME="+manager,
  "PROTOCOLIA_MANAGER_PASSWORD="+pw,
  "PROTOCOLIA_READER_USERNAME="+reader,
  "PROTOCOLIA_READER_PASSWORD="+rp,
  "PROTOCOLIA_HOST_PORT="+hostPort
 ].join("\n")+"\n",{mode:0o600});
 args=["compose","--project-name",project,"--env-file",env];
 docker([...args,"config","--quiet"],15000);started=true;
 docker([...args,"up","--detach","--build"]);
 const base="http://127.0.0.1:"+hostPort,deadline=Date.now()+120000;
 let ready=false;
 while(Date.now()<deadline){
  try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(2000)})).status===200){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(ready,"Generated app failed to become healthy");
 async function req(path,{method="GET",body,who="manager"}={}){
  const response=await fetch(base+path,{method,headers:{
   ...(who==="manager"?{Authorization:basic(manager,pw)}:who==="reader"?{Authorization:basic(reader,rp)}:{}),
   ...(body===undefined?{}:{"Content-Type":"application/json"})
  },...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data=raw}
  return {status:response.status,body:data};
 }
 const id=token+"-manager",readerId=token+"-reader",unknown=token+"-unknown";
 const change=(code,body,who="manager")=>req("/api/notes/"+code+"/title",{method:"PATCH",body,who});
 assert.equal((await req("/api/notes",{who:null})).status,401);
 assert.equal((await req("/api/notes/"+id,{who:null})).status,401);
 assert.equal((await req("/api/notes",{method:"POST",who:"reader",body:{noteCode:unknown,title:"not allowed"}})).status,403);
 const forged=await req("/api/notes",{method:"POST",body:{noteCode:unknown,title:"Forged",owner:reader}});
 assert.equal(forged.status,400,JSON.stringify(forged));
 assert.equal((await req("/api/notes/"+unknown)).status,404);
 const created=await req("/api/notes",{method:"POST",body:{noteCode:id,title:"Private note",privateMemo:"Manager top secret"}});
 assert.equal(created.status,201,JSON.stringify(created));
 assert.equal(created.body.owner,manager);
 assert.equal(created.body.privateMemo,"Manager top secret");
 const readerSession=await req("/api/_protocolia/me",{who:"reader"});
 const managerSession=await req("/api/_protocolia/me");
 assert.ok(managerSession.body.capabilities.includes("notes.private.read"));
 assert.ok(!readerSession.body.capabilities.includes("notes.private.read"));
 assert.ok(readerSession.body.capabilities.includes("notes.read"));
 assert.equal((await req("/api/notes",{method:"POST",body:{noteCode:id,title:"duplicate"}})).status,409);
 assert.equal((await req("/api/notes/"+id)).status,200);
 assert.equal((await req("/api/notes/"+id,{who:"reader"})).status,404,"Foreign row indistinguishable from missing");
 assert.equal((await change(id,{title:"reader cannot edit"},"reader")).status,403);
 assert.equal((await change(id,{owner:reader})).status,400);
 assert.equal((await change(id,{title:"New title",owner:reader})).status,400);
 assert.equal((await change(id,{title:""})).status,400);
 assert.equal((await change(unknown,{title:"New title"})).status,404);
 const changed=await change(id,{title:"Private and edited"});
 assert.equal(changed.status,200,JSON.stringify(changed));
 assert.equal(changed.body.title,"Private and edited");
 assert.equal(changed.body.owner,manager);
 assert.equal(changed.body.privateMemo,"Manager top secret");
 let page=await req("/api/notes?limit=25&offset=0");
 assert.equal(page.status,200);
 assert.equal(page.body.total,1);
 assert.deepEqual(page.body.items.map(x=>x.noteCode),[id]);
 assert.equal(page.body.items[0].privateMemo,"Manager top secret");
 page=await req("/api/notes?limit=25&offset=0",{who:"reader"});
 assert.equal(page.status,200);
 assert.equal(page.body.total,0,"Foreign rows must not leak through total");
 assert.deepEqual(page.body.items,[]);
 // Simulate independently owned records created by a separate trusted system.
 // Reader has read-only demo role, so fixture seeds the second subject via local disposable DB.
 docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia","-v","ON_ERROR_STOP=1","-c",
  "INSERT INTO private_note (note_code, owner, title, private_memo) VALUES ('"+readerId+"','"+reader+"','Reader private','Reader hidden secret')"],15000);
 const scoped=await req("/api/notes/"+readerId,{who:"reader"});
 assert.equal(scoped.status,200);
 assert.equal(Object.hasOwn(scoped.body,"privateMemo"),false,"Restricted field must be absent, not null");
 assert.equal((await req("/api/notes/"+readerId)).status,404,"Manager must not bypass row ownership");
 assert.equal((await change(readerId,{title:"Must not change foreign title"})).status,404,
   "Even a manager with write capability cannot update a foreign row");
 assert.equal((await req("/api/notes/"+readerId,{who:"reader"})).body.title,"Reader private");
 assert.equal((await change(readerId,{title:"Reader cannot patch"},"reader")).status,403);
 const readerPage=await req("/api/notes?limit=25&offset=0",{who:"reader"});
 assert.equal(readerPage.body.total,1);
 assert.equal(Object.hasOwn(readerPage.body.items[0],"privateMemo"),false,"Paged content must also omit restricted field");
 assert.deepEqual(readerPage.body.items.map(x=>x.noteCode),[readerId]);
 const managerPage=await req("/api/notes?limit=25&offset=0");
 assert.equal(managerPage.body.total,1);
 assert.deepEqual(managerPage.body.items.map(x=>x.noteCode),[id]);
 assert.equal((await req("/api/notes?limit=1&offset=1",{who:"reader"})).body.items.length,0);
 assert.equal((await req("/api/notes?limit=1&offset=1")).body.total,1);
 if(process.argv.includes("--browser")){
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
   const errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.goto(base+"/",{waitUntil:"domcontentloaded"});
   await page.getByTestId("username").fill(manager);
   await page.getByTestId("password").fill(pw);
   await page.getByRole("button",{name:"Entrar",exact:true}).click();
   await page.getByTestId("open-create").click();
   const form=page.getByTestId("create-form-PrivateNote");
   assert.equal(await form.getByTestId("create-owner").count(),0,"Owner is not client-editable");
   await form.getByTestId("create-noteCode").fill(token+"-mobile");
   await form.getByTestId("create-title").fill("My mobile private note");
   await form.getByTestId("create-privateMemo").fill("UI manager secret");
   await form.getByRole("button",{name:"Crear",exact:true}).click();
   await page.getByTestId("create-dialog").waitFor({state:"hidden",timeout:15000});
   assert.equal((await req("/api/notes/"+token+"-mobile")).body.owner,manager);
   assert.equal((await req("/api/notes/"+token+"-mobile")).body.privateMemo,"UI manager secret");
   assert.equal((await req("/api/notes/"+token+"-mobile",{who:"reader"})).status,404);
   await page.getByTestId("open-detail-"+token+"-mobile").click();
   await page.getByTestId("detail-dialog").getByText("UI manager secret").waitFor();
   await page.getByTestId("rename").fill("Mobile edited");
   await page.getByRole("button",{name:"Guardar cambios"}).click();
   const end=Date.now()+12000;let reflected=false;
   while(Date.now()<end){
     if((await req("/api/notes/"+token+"-mobile")).body.title==="Mobile edited"){reflected=true;break;}
     await page.waitForTimeout(250);
   }
   assert.ok(reflected,"Generated mobile PATCH must respect independent field capability");
   assert.equal(errors.length,0,errors.join("; "));
   await page.screenshot({path:join(generated,"s1-owner-mobile.png"),fullPage:true});
  }finally{await browser.close();}
 }
 docker([...args,"restart","app"],120000);
 const restartDeadline=Date.now()+70000;
 let persisted=false;
 while(Date.now()<restartDeadline){
  try{if((await req("/api/notes/"+id)).status===200&&(await req("/api/notes/"+id,{who:"reader"})).status===404){persisted=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(persisted,"Ownership must persist after restart");
 console.log("PROTOCOLIA_S1C_FIELD_READ_PASS "+JSON.stringify({creatorBound:true,noSpoof:true,foreignReads404:true,pagedTotalsScoped:true,independentWriteCapability:true,fieldAllowlist:true,foreignWrites404:true,privateReadCapability:true,omittedInDetailAndPage:true,dualSubjects:true,persistent:true,mobile:process.argv.includes("--browser")}));
}finally{
 if(started)try{docker([...args,"down","--volumes","--remove-orphans"],120000)}catch(error){console.error(error.message);process.exitCode=1;}
 rmSync(work,{recursive:true,force:true});
}
