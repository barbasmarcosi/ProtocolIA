#!/usr/bin/env node
// Mobile Chromium oracle for a fresh generated domain. Only isolated Compose
// and random disposable credentials: no consumer DB or production effects.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes,createHash} from "node:crypto";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createServer} from "node:net";
import {chromium} from "playwright";

const output=resolve(process.argv[2]??"");
const info=JSON.parse(readFileSync(join(output,"protocolia-build.json"),"utf8"));
assert.ok(["nestjs","modular-spring"].includes(info.target));
const scratch=mkdtempSync(join(tmpdir(),"pia-community-browser-"));
const project="pia_community_"+randomBytes(5).toString("hex");
const pass=randomBytes(18).toString("hex");
const data={
  PROTOCOLIA_DB_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_ALLOW_DEMO_AUTH:"true",
  PROTOCOLIA_MANAGER_USERNAME:"community_manager",
  PROTOCOLIA_MANAGER_PASSWORD:pass,
  PROTOCOLIA_READER_USERNAME:"community_reader",
  PROTOCOLIA_READER_PASSWORD:randomBytes(18).toString("hex")
};
let started=false,browser;
function docker(...args){
  const child=spawnSync("docker",["compose","--project-name",project,
    "--env-file",join(scratch,"test.env"),...args],{
    cwd:output,env:{...process.env,...data},encoding:"utf8",timeout:600000,
    maxBuffer:3*1024*1024
  });
  if(child.error||child.status!==0)
    throw Error("Docker Compose "+args.join(" ")+" failed: "+
      (child.stderr??child.error?.message??"").slice(-1300));
  return child.stdout?.trim();
}
async function port(){
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const n=server.address().port;
      server.close(error=>error?reject(error):resolve(n));
    });
  });
}
async function waitHealth(base){
  for(let i=0;i<120;i++){
    try{const response=await fetch(base+"/health",{signal:AbortSignal.timeout(2500)});
      if(response.status===200)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error("Generated CommunityArchive HTTP health did not become ready");
}
const auth=(name,password)=>"Basic "+Buffer.from(name+":"+password).toString("base64");
const cases=[];
function accepted(id){cases.push(id);console.log("PROTOCOLIA_V12_BLACKBOX_CASE_PASS "+id);}
async function http(base,path,{method="GET",identity="manager",body}={}){
  const [name,password]=identity==="manager"?
    [data.PROTOCOLIA_MANAGER_USERNAME,pass]:
    [data.PROTOCOLIA_READER_USERNAME,data.PROTOCOLIA_READER_PASSWORD];
  const res=await fetch(base+path,{method,headers:{
    Authorization:auth(name,password),
    ...(body===undefined?{}:{"Content-Type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:res.status,body:res.status===204?null:await res.json().catch(()=>null)};
}

try{
  const listenPort=await port();
  data.PROTOCOLIA_HOST_PORT=String(listenPort);
  writeFileSync(join(scratch,"test.env"),
    Object.entries(data).map(([key,value])=>key+"="+value).join("\n")+"\n",{mode:0o600});
  docker("config","--quiet");
  started=true;
  docker("up","--detach","--build");
  const base="http://127.0.0.1:"+listenPort;
  await waitHealth(base);
  browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base+"/",{waitUntil:"domcontentloaded"});
  await page.locator('[data-testid="username"]').fill(data.PROTOCOLIA_MANAGER_USERNAME);
  await page.locator('[data-testid="password"]').fill(pass);
  await page.getByRole("button",{name:"Entrar"}).click();
  await page.locator('[data-testid="open-create"]').click();
  const room=page.locator('[data-testid="create-form-ArchiveRoom"]');
  await room.locator('[data-testid="create-roomCode"]').fill("ROOM-A1");
  await room.locator('[data-testid="create-label"]').fill("Colección comunitaria");
  await room.getByRole("button",{name:"Crear"}).click();
  await page.locator('[data-testid="open-detail-ROOM-A1"]').waitFor({timeout:20000});
  const registeredRoom=await http(base,"/api/archive-rooms/ROOM-A1");
  assert.equal(registeredRoom.status,200);
  assert.equal(registeredRoom.body.label,"Colección comunitaria");
  accepted("CA-01");
  const duplicateRoom=await http(base,"/api/archive-rooms",{method:"POST",body:{
    roomCode:"ROOM-A1",label:"Must not overwrite"
  }});
  assert.equal(duplicateRoom.status,409);
  assert.equal((await http(base,"/api/archive-rooms/ROOM-A1")).body.label,"Colección comunitaria");
  accepted("CA-02");
  await page.getByRole("navigation",{name:"Secciones de la aplicación"})
    .getByRole("button",{name:"Cajas documentales"}).click();
  await page.locator('[data-testid="open-create"]').click();
  const box=page.locator('[data-testid="create-form-RecordBox"]');
  await box.locator('[data-testid="create-reference"]').fill("BOX-A1");
  await box.locator('[data-testid="create-description"]').fill("Actas comunitarias");
  await box.locator('[data-testid="create-pagesDigitized"]').fill("4");
  await box.locator('[data-testid="create-roomCode"]').click();
  await page.getByRole("option",{name:/ROOM-A1/}).click();
  assert.equal(await box.locator('[data-testid="create-roomCode"]').getAttribute("data-selected-key"),"ROOM-A1");
  await box.getByRole("button",{name:"Crear"}).click();
  await page.locator('[data-testid="open-detail-BOX-A1"]').waitFor({timeout:20000});
  const read=await fetch(base+"/api/record-boxes/BOX-A1",{
    headers:{Authorization:auth(data.PROTOCOLIA_MANAGER_USERNAME,pass)}});
  assert.equal(read.status,200);
  const item=await read.json();
  assert.equal(item.roomCode,"ROOM-A1");
  assert.equal(item.pagesDigitized,4);
  assert.equal(item.description,"Actas comunitarias");
  accepted("CA-03");
  const orphan=await http(base,"/api/record-boxes",{method:"POST",body:{
    reference:"BOX-ORPHAN",roomCode:"ROOM-MISSING",
    description:"Must be rejected",pagesDigitized:0
  }});
  assert.equal(orphan.status,400);
  assert.equal((await http(base,"/api/record-boxes/BOX-ORPHAN")).status,404);
  accepted("CA-04");
  let browserBoxPosts=0;
  page.on("request",request=>{
    if(request.method()==="POST"&&
      new URL(request.url()).pathname==="/api/record-boxes")browserBoxPosts++;
  });
  await page.locator('[data-testid="open-create"]').click();
  const unsaved=page.locator('[data-testid="create-form-RecordBox"]');
  await unsaved.locator('[data-testid="create-reference"]').fill("BOX-UNSAVED");
  await unsaved.getByRole("button",{name:"Cancelar"}).click();
  await page.locator('[data-testid="unsaved-changes-confirmation"]').waitFor();
  await page.getByRole("button",{name:"Seguir editando"}).click();
  assert.equal(await unsaved.locator('[data-testid="create-reference"]').inputValue(),"BOX-UNSAVED");
  await unsaved.getByRole("button",{name:"Cancelar"}).click();
  await page.locator('[data-testid="unsaved-changes-confirmation"]').waitFor();
  await page.getByRole("button",{name:"Descartar cambios"}).click();
  await page.locator('[data-testid="create-dialog"]').waitFor({state:"hidden"});
  assert.equal(browserBoxPosts,0,"Draft cancellation must never POST");
  assert.equal((await http(base,"/api/record-boxes/BOX-UNSAVED")).status,404);
  accepted("CA-05");
  await page.locator('[data-testid="open-detail-BOX-A1"]').click();
  const detail=page.locator('[data-testid="detail-dialog"]');
  await detail.locator('[data-testid="rename"]').fill("Actas restauradas");
  const patchWait=page.waitForResponse(res=>
    new URL(res.url()).pathname==="/api/record-boxes/BOX-A1/description"&&
    res.request().method()==="PATCH");
  await detail.getByRole("button",{name:"Guardar cambios"}).click();
  assert.equal((await patchWait).status(),200);
  await page.waitForFunction(async ()=>{
    const dialog=document.querySelector('[data-testid="detail-dialog"]');
    return dialog?.textContent?.includes("Actas restauradas");
  });
  const afterEdit=await http(base,"/api/record-boxes/BOX-A1");
  assert.equal(afterEdit.status,200);
  assert.equal(afterEdit.body.description,"Actas restauradas");
  assert.equal(afterEdit.body.roomCode,"ROOM-A1");
  assert.equal(afterEdit.body.pagesDigitized,4);
  accepted("CA-06");
  const writerHeaders={Authorization:auth(data.PROTOCOLIA_MANAGER_USERNAME,pass),
    "Content-Type":"application/json"};
  const increments=await Promise.all(Array.from({length:10},()=>fetch(
    base+"/api/record-boxes/BOX-A1/scanned",{
      method:"PATCH",headers:writerHeaders,body:JSON.stringify({delta:1})
    })));
  assert.ok(increments.every(res=>res.status===200),
    "Ten independent concurrent increments must all commit");
  const afterIncrement=await http(base,"/api/record-boxes/BOX-A1");
  assert.equal(afterIncrement.body.pagesDigitized,14);
  accepted("CA-07");
  const badIncrement=await http(base,"/api/record-boxes/BOX-A1/scanned",{
    method:"PATCH",body:{delta:0}});
  assert.equal(badIncrement.status,400);
  assert.equal((await http(base,"/api/record-boxes/BOX-A1")).body.pagesDigitized,14);
  accepted("CA-08");
  const forbiddenDelete=await http(base,"/api/archive-rooms/ROOM-A1",{
    method:"DELETE"});
  assert.equal(forbiddenDelete.status,409);
  assert.equal((await http(base,"/api/archive-rooms/ROOM-A1")).status,200);
  assert.equal((await http(base,"/api/record-boxes/BOX-A1")).status,200);
  accepted("CA-09");
  await detail.getByRole("button",{name:"Cerrar detalle"}).click();
  await detail.waitFor({state:"hidden"});
  const image=await page.screenshot({fullPage:true});
  await page.getByRole("button",{name:"Cerrar sesión"}).click();
  await page.locator('[data-testid="username"]').fill(data.PROTOCOLIA_READER_USERNAME);
  await page.locator('[data-testid="password"]').fill(data.PROTOCOLIA_READER_PASSWORD);
  await page.getByRole("button",{name:"Entrar"}).click();
  await page.locator('[data-testid="open-detail-BOX-A1"]').waitFor({timeout:20000});
  assert.equal(await page.locator('[data-testid="open-create"]').count(),0,
    "Reader cannot see mutation buttons");
  await page.locator('[data-testid="open-detail-BOX-A1"]').click();
  const readerDetail=page.locator('[data-testid="detail-dialog"]');
  await readerDetail.waitFor();
  assert.equal(await readerDetail.getByRole("button",{name:"Guardar cambios"}).count(),0);
  assert.equal(await readerDetail.getByRole("button",{name:"Incrementar"}).count(),0);
  const denied=await fetch(base+"/api/record-boxes",{
    method:"POST",headers:{"Content-Type":"application/json",
      Authorization:auth(data.PROTOCOLIA_READER_USERNAME,data.PROTOCOLIA_READER_PASSWORD)},
    body:JSON.stringify({reference:"FORBIDDEN",roomCode:"ROOM-A1",
      description:"Must not persist",pagesDigitized:0})});
  assert.equal(denied.status,403);
  const deniedPatch=await http(base,"/api/record-boxes/BOX-A1/description",{
    method:"PATCH",identity:"reader",body:{description:"Malicious edit"}
  });
  assert.equal(deniedPatch.status,403);
  assert.equal((await http(base,"/api/record-boxes/BOX-A1")).body.description,"Actas restauradas");
  accepted("CA-10");
  await page.reload({waitUntil:"domcontentloaded"});
  // Persistence after refresh is mandatory; retention of a demo-auth session is not.
  if(await page.locator('[data-testid="username"]').count()){
    await page.locator('[data-testid="username"]').fill(data.PROTOCOLIA_READER_USERNAME);
    await page.locator('[data-testid="password"]').fill(data.PROTOCOLIA_READER_PASSWORD);
    await page.getByRole("button",{name:"Entrar"}).click();
  }
  if(await page.getByRole("navigation",{name:"Secciones de la aplicación"})
    .getByRole("button",{name:"Cajas documentales"}).count())
    await page.getByRole("navigation",{name:"Secciones de la aplicación"})
      .getByRole("button",{name:"Cajas documentales"}).click();
  await page.locator('[data-testid="open-detail-BOX-A1"]').waitFor({timeout:20000});
  assert.equal((await http(base,"/api/record-boxes/BOX-A1",{identity:"reader"})).body.description,
    "Actas restauradas");
  assert.equal((await http(base,"/api/record-boxes/BOX-A1",{identity:"reader"})).body.pagesDigitized,14);
  accepted("CA-11");
  assert.deepEqual(errors,[],"No uncaught browser JavaScript errors");
  accepted("CA-12");
  assert.deepEqual(cases,Array.from({length:12},(_,i)=>
    "CA-"+String(i+1).padStart(2,"0")));
  console.log("PROTOCOLIA_V12_BLACKBOX_CUSTOMER_RUBRIC_PASS "+JSON.stringify({
    target:info.target,cases:cases.length,caseIds:cases,
    browserErrors:errors.length,finalDigitizedPages:14
  }));
  console.log("PROTOCOLIA_V12_COMMUNITY_ARCHIVE_MOBILE_CHROMIUM_PASS "+JSON.stringify({
    target:info.target,viewport:"390x844",relatedRecordCreated:true,
    serverReadMatchesUi:true,readerWriteDenied:true,pageErrors:errors.length,
    screenshotSha256:createHash("sha256").update(image).digest("hex")
  }));
}finally{
  try{await browser?.close();}catch{}
  if(started)try{docker("down","--volumes","--remove-orphans");}
    catch(error){console.error("PROTOCOLIA_V12_BROWSER_CLEANUP_FAILED "+error.message);
      process.exitCode=1;}
  rmSync(scratch,{force:true,recursive:true});
}
