#!/usr/bin/env node
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";

const generated=resolve(process.argv[2]??"");
assert.ok(process.argv[2],"Generated app directory required");
const token=randomBytes(5).toString("hex"),project="s1d2_rel_"+token;
const work=mkdtempSync(join(tmpdir(),"protocolia-owner-relation-"));
const manager="link_manager",reader="link_reader",scoped="link_scoped";
const mp=randomBytes(18).toString("hex"),rp=randomBytes(18).toString("hex"),sp=randomBytes(18).toString("hex");
const credentials={manager:[manager,mp],reader:[reader,rp],scoped:[scoped,sp]};
const basic=(u,p)=>"Basic "+Buffer.from(u+":"+p).toString("base64");
const schema=readFileSync(existsSync(join(generated,"src/schema.sql"))?
  join(generated,"src/schema.sql"):
  join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
assert.match(schema,/REFERENCES folder\s*\(folder_code\)/i);
function docker(params,timeout=600000){
 const r=spawnSync("docker",params,{cwd:generated,encoding:"utf8",timeout});
 if(r.status!==0||r.error)throw Error("Docker "+params.join(" ")+" failed: "+
   (r.stderr??r.error?.message??"").slice(-1900));
 return r.stdout;
}
async function freePort(){return await new Promise((resolve,reject)=>{
 const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{
  const p=s.address().port;s.close(()=>resolve(p));
 });
});}
let args=[],running=false;
try{
 const port=await freePort(),env=join(work,"env");
 writeFileSync(env,[
  "PROTOCOLIA_DB_PASSWORD="+randomBytes(20).toString("hex"),
  "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
  "PROTOCOLIA_MANAGER_USERNAME="+manager,"PROTOCOLIA_MANAGER_PASSWORD="+mp,
  "PROTOCOLIA_READER_USERNAME="+reader,"PROTOCOLIA_READER_PASSWORD="+rp,
  "PROTOCOLIA_SCOPED_USERNAME="+scoped,"PROTOCOLIA_SCOPED_PASSWORD="+sp,
  "PROTOCOLIA_SCOPED_CAPABILITIES=folders.read,folderNotes.read,folderNotes.write",
  "PROTOCOLIA_HOST_PORT="+port
 ].join("\n")+"\n",{mode:0o600});
 args=["compose","--project-name",project,"--env-file",env];
 docker([...args,"config","--quiet"],15000);running=true;
 docker([...args,"up","--detach","--build"]);
 const base="http://127.0.0.1:"+port;
 let ready=false,deadline=Date.now()+120000;
 while(Date.now()<deadline){
  try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(2000)})).status===200){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(ready,"Generated app not ready");
 async function req(path,{method="GET",body,who="manager"}={}){
  const creds=credentials[who];
  const response=await fetch(base+path,{method,headers:{
   ...(creds?{Authorization:basic(...creds)}:{}),
   ...(body===undefined?{}:{"Content-Type":"application/json"})
  },...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(15000)});
  const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data=raw}
  return {status:response.status,body:data};
 }
 const managerFolder=token+"-manager-folder",readerFolder=token+"-reader-folder",scopedFolder=token+"-scoped-folder";
 const managerNote=token+"-manager-note",scopedNote=token+"-scoped-note";
 const folderInput=(code,title="Private folder")=>({folderCode:code,title});
 const noteInput=(code,parent,title="Private child")=>({noteCode:code,folderCode:parent,title});
 assert.equal((await req("/api/folders",{who:null})).status,401);
 assert.equal((await req("/api/folder-notes",{who:null})).status,401);
 assert.equal((await req("/api/folders",{method:"POST",who:"scoped",body:folderInput(scopedFolder)})).status,403);
 const ownParent=await req("/api/folders",{method:"POST",body:folderInput(managerFolder)});
 assert.equal(ownParent.status,201,JSON.stringify(ownParent));
 assert.equal(ownParent.body.owner,manager);
 assert.equal((await req("/api/folders",{method:"POST",body:{...folderInput(token+"-forge"),owner:scoped}})).status,400);
 // Cross-owner parents live only in this ephemeral PostgreSQL instance.
 docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia","-v","ON_ERROR_STOP=1","-c",
  "INSERT INTO folder (folder_code,owner,title) VALUES ('"+readerFolder+"','"+reader+"','Reader parent'),('"+scopedFolder+"','"+scoped+"','Scoped parent')"],15000);
 const unreadable=await req("/api/folders/"+readerFolder);
 assert.equal(unreadable.status,404,"Parent must be scoped");
 assert.equal((await req("/api/folders/"+scopedFolder,{who:"scoped"})).status,200);
 const ownChild=await req("/api/folder-notes",{method:"POST",body:noteInput(managerNote,managerFolder)});
 assert.equal(ownChild.status,201,JSON.stringify(ownChild));
 assert.equal(ownChild.body.owner,manager);
 assert.equal(ownChild.body.folderCode,managerFolder);
 const foreignChild=await req("/api/folder-notes",{method:"POST",body:noteInput(token+"-foreign",readerFolder)});
 assert.equal(foreignChild.status,400,JSON.stringify(foreignChild));
 assert.equal((await req("/api/folder-notes",{method:"POST",body:noteInput(token+"-other",scopedFolder)})).status,400);
 assert.equal((await req("/api/folder-notes",{method:"POST",body:noteInput(token+"-missing",token+"-missing-folder")})).status,400);
 assert.equal((await req("/api/folder-notes/"+token+"-foreign")).status,404);
 const scopedSession=await req("/api/_protocolia/me",{who:"scoped"});
 assert.equal(scopedSession.status,200);
 assert.deepEqual(scopedSession.body.capabilities,["folderNotes.read","folderNotes.write","folders.read"]);
 assert.equal((await req("/api/folder-notes",{method:"POST",who:"reader",body:noteInput(token+"-denied",readerFolder)})).status,403);
 const scopedChild=await req("/api/folder-notes",{method:"POST",who:"scoped",body:noteInput(scopedNote,scopedFolder)});
 assert.equal(scopedChild.status,201,JSON.stringify(scopedChild));
 assert.equal(scopedChild.body.owner,scoped);
 assert.equal((await req("/api/folder-notes",{method:"POST",who:"scoped",body:noteInput(token+"-wrong-parent",managerFolder)})).status,400);
 assert.equal((await req("/api/folder-notes/"+managerNote,{who:"scoped"})).status,404);
 assert.equal((await req("/api/folder-notes/"+scopedNote)).status,404);
 const mine=await req("/api/folder-notes?limit=20&offset=0");
 const theirs=await req("/api/folder-notes?limit=20&offset=0",{who:"scoped"});
 assert.equal(mine.body.total,1);
 assert.deepEqual(mine.body.items.map(x=>x.noteCode),[managerNote]);
 assert.equal(theirs.body.total,1);
 assert.deepEqual(theirs.body.items.map(x=>x.noteCode),[scopedNote]);
 assert.equal((await req("/api/folder-notes?limit=20&offset=0",{who:"reader"})).body.total,0);
 const parents=await req("/api/folders?limit=20&offset=0");
 assert.equal(parents.body.total,1);
 assert.deepEqual(parents.body.items.map(x=>x.folderCode),[managerFolder]);
 const scopedParents=await req("/api/folders?limit=20&offset=0",{who:"scoped"});
 assert.equal(scopedParents.body.total,1);
 assert.deepEqual(scopedParents.body.items.map(x=>x.folderCode),[scopedFolder]);
 if(process.argv.includes("--browser")){
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
   const errors=[];page.on("pageerror",error=>errors.push(error.message));
   await page.goto(base+"/?resource=FolderNote",{waitUntil:"domcontentloaded"});
   await page.getByTestId("username").fill(manager);
   await page.getByTestId("password").fill(mp);
   await page.getByRole("button",{name:"Entrar",exact:true}).click();
   await page.getByTestId("open-create").click();
   const form=page.getByTestId("create-form-FolderNote");
   assert.equal(await form.getByTestId("create-owner").count(),0);
   await form.getByTestId("create-noteCode").fill(token+"-mobile");
   await form.getByTestId("create-title").fill("Mobile guarded child");
   const picker=form.getByTestId("create-folderCode");
   await picker.click();
   const ownOption=page.getByRole("option").filter({hasText:managerFolder});
   await ownOption.waitFor({state:"visible",timeout:15000});
   assert.equal(await page.getByRole("option").filter({hasText:readerFolder}).count(),0);
   assert.equal(await page.getByRole("option").filter({hasText:scopedFolder}).count(),0);
   await ownOption.first().click();
   assert.equal(await picker.getAttribute("data-selected-key"),managerFolder);
   const responsePromise=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/folder-notes");
   await form.getByRole("button",{name:"Crear",exact:true}).click();
   assert.equal((await responsePromise).status(),201);
   await page.getByTestId("create-dialog").waitFor({state:"hidden",timeout:15000});
   assert.equal((await req("/api/folder-notes/"+token+"-mobile")).body.folderCode,managerFolder);
   assert.deepEqual(errors,[]);
   await page.screenshot({path:join(generated,"s1-owner-relation-mobile.png"),fullPage:true});
  }finally{await browser.close();}
 }
 docker([...args,"restart","app"],120000);
 let persisted=false;
 const end=Date.now()+75000;
 while(Date.now()<end){
  try{
   if((await req("/api/folder-notes/"+managerNote)).status===200&&
      (await req("/api/folder-notes/"+scopedNote,{who:"scoped"})).status===200&&
      (await req("/api/folder-notes/"+scopedNote)).status===404){persisted=true;break;}
  }catch{}
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(persisted,"Private relationship must persist across restart");
 console.log("PROTOCOLIA_S1D2_OWNER_RELATION_PASS "+JSON.stringify({
   atomicParentOwnerCheck:true,foreignParentRejected:true,absentParentRejected:true,
   scopedPartialGrants:true,ownerListCounts:true,foreignChild404:true,
   twoBackendIndependent:true,persistent:true,mobile:process.argv.includes("--browser")
 }));
}finally{
 if(running)try{docker([...args,"down","--volumes","--remove-orphans"],120000)}
 catch(e){console.error(e.message);process.exitCode=1;}
 rmSync(work,{recursive:true,force:true});
}
