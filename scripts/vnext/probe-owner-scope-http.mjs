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
const manager="scope_manager",reader="scope_reader",scoped="scope_private_reader";
const pw=randomBytes(18).toString("hex"),rp=randomBytes(18).toString("hex"),sp=randomBytes(18).toString("hex");
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
  "PROTOCOLIA_SCOPED_USERNAME="+scoped,
  "PROTOCOLIA_SCOPED_PASSWORD="+sp,
  "PROTOCOLIA_SCOPED_CAPABILITIES=notes.read,notes.private.read",
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
   ...(who==="manager"?{Authorization:basic(manager,pw)}:who==="reader"?{Authorization:basic(reader,rp)}:
      who==="scoped"?{Authorization:basic(scoped,sp)}:{}),
   ...(body===undefined?{}:{"Content-Type":"application/json"})
  },...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data=raw}
  return {status:response.status,body:data};
 }
 const id=token+"-manager",readerId=token+"-reader",scopedId=token+"-scoped",unknown=token+"-unknown";
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
 const scopedSession=await req("/api/_protocolia/me",{who:"scoped"});
 assert.equal(scopedSession.status,200);
 assert.equal(scopedSession.body.username,scoped);
 assert.deepEqual(scopedSession.body.capabilities,["notes.private.read","notes.read"]);
 assert.equal((await req("/api/_protocolia/me?capabilities=notes.write",{who:"scoped"})).body.capabilities.length,2);
 assert.equal((await req("/api/notes",{method:"POST",who:"scoped",
   body:{noteCode:unknown,title:"Forged privilege"}})).status,403);
 assert.equal((await req("/api/notes/"+id,{who:"scoped"})).status,404);
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
 const readerOwn=await req("/api/notes/"+readerId,{who:"reader"});
 assert.equal(readerOwn.status,200);
 assert.equal(Object.hasOwn(readerOwn.body,"privateMemo"),false,"Restricted field must be absent, not null");
 assert.equal((await req("/api/notes/"+readerId)).status,404,"Manager must not bypass row ownership");
 assert.equal((await change(readerId,{title:"Must not change foreign title"})).status,404,
   "Even a manager with write capability cannot update a foreign row");
 assert.equal((await req("/api/notes/"+readerId,{who:"reader"})).body.title,"Reader private");
 assert.equal((await change(readerId,{title:"Reader cannot patch"},"reader")).status,403);
 docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia","-v","ON_ERROR_STOP=1","-c",
  "INSERT INTO private_note (note_code, owner, title, private_memo) VALUES ('"+scopedId+"','"+scoped+"','Scoped own note','Scoped own secret')"],15000);
 const scopedDetails=await req("/api/notes/"+scopedId,{who:"scoped"});
 assert.equal(scopedDetails.status,200);
 assert.equal(scopedDetails.body.privateMemo,"Scoped own secret");
 assert.equal(scopedDetails.body.owner,scoped);
 assert.equal((await req("/api/notes/"+scopedId,{who:"reader"})).status,404);
 assert.equal((await req("/api/notes/"+scopedId)).status,404);
 const scopedPage=await req("/api/notes?limit=25&offset=0",{who:"scoped"});
 assert.equal(scopedPage.body.total,1);
 assert.deepEqual(scopedPage.body.items.map(x=>x.noteCode),[scopedId]);
 assert.equal(scopedPage.body.items[0].privateMemo,"Scoped own secret");
 assert.equal((await change(scopedId,{title:"Cannot write despite read"},"scoped")).status,403);
 assert.equal((await req("/api/notes/"+scopedId,{who:"scoped"})).body.title,"Scoped own note");
 const forgedResponse=await fetch(base+"/api/notes/"+scopedId,{method:"PATCH",headers:{Authorization:basic(scoped,sp),
   "X-ProtocolIA-Capabilities":"notes.write,notes.title.write", "Content-Type":"application/json"},
   body:JSON.stringify({title:"Header forgery"}),signal:AbortSignal.timeout(15000)});
 assert.equal(forgedResponse.status,403,"Client-selected authority header cannot escalate");
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
   const scopePage=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
   try{
     await scopePage.goto(base+"/",{waitUntil:"domcontentloaded"});
     await scopePage.getByTestId("username").fill(scoped);
     await scopePage.getByTestId("password").fill(sp);
     await scopePage.getByRole("button",{name:"Entrar",exact:true}).click();
     await scopePage.getByTestId("open-detail-"+scopedId).click();
     await scopePage.getByTestId("detail-dialog").getByText("Scoped own secret").waitFor();
     assert.equal(await scopePage.getByTestId("open-create").count(),0);
     assert.equal(await scopePage.getByTestId("rename").count(),0);
   }finally{await scopePage.close();}
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
 // Invalid test-only authority configuration must fail closed on startup.
 const bad=spawnSync("docker",[...args,"run","--rm","--no-deps","-e","PROTOCOLIA_SCOPED_CAPABILITIES=notes.read,notes.nonexistent","app"],
   {cwd:generated,encoding:"utf8",timeout:60000});
 assert.notEqual(bad.status,0,"Unknown scoped capability must prevent app startup");
 assert.match((bad.stdout??"")+"\n"+(bad.stderr??""),/Invalid scoped test authority allowlist/);
 console.log("PROTOCOLIA_S1D_PARTIAL_AUTH_PASS "+JSON.stringify({creatorBound:true,noSpoof:true,foreignReads404:true,pagedTotalsScoped:true,independentWriteCapability:true,fieldAllowlist:true,foreignWrites404:true,privateReadCapability:true,omittedInDetailAndPage:true,thirdSubject:true,exactPartialGrants:true,unknownGrantFailsClosed:true,persistent:true,mobile:process.argv.includes("--browser")}));
}finally{
 if(started)try{docker([...args,"down","--volumes","--remove-orphans"],120000)}catch(error){console.error(error.message);process.exitCode=1;}
 rmSync(work,{recursive:true,force:true});
}
