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
  const image=await page.screenshot({fullPage:true});
  await page.getByRole("button",{name:"Cerrar sesión"}).click();
  await page.locator('[data-testid="username"]').fill(data.PROTOCOLIA_READER_USERNAME);
  await page.locator('[data-testid="password"]').fill(data.PROTOCOLIA_READER_PASSWORD);
  await page.getByRole("button",{name:"Entrar"}).click();
  await page.locator('[data-testid="open-detail-BOX-A1"]').waitFor({timeout:20000});
  assert.equal(await page.locator('[data-testid="open-create"]').count(),0,
    "Reader cannot see mutation buttons");
  const denied=await fetch(base+"/api/record-boxes",{
    method:"POST",headers:{"Content-Type":"application/json",
      Authorization:auth(data.PROTOCOLIA_READER_USERNAME,data.PROTOCOLIA_READER_PASSWORD)},
    body:JSON.stringify({reference:"FORBIDDEN",roomCode:"ROOM-A1",
      description:"Must not persist",pagesDigitized:0})});
  assert.equal(denied.status,403);
  assert.deepEqual(errors,[],"No uncaught browser JavaScript errors");
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
