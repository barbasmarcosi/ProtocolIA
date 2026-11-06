#!/usr/bin/env node
// Bounded R4 maintenance exercise. Disposable DB and a deliberately specified
// additive field; no remote agents or external business policy changes.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";

const mode=process.argv[2];
const base="http://127.0.0.1:8080";
const auth=(role)=>"Basic "+Buffer.from(role+":"+process.env[
  role==="manager"?"PROTOCOLIA_MANAGER_PASSWORD":"PROTOCOLIA_READER_PASSWORD"
]).toString("base64");
async function waitForHealthy(){
  const deadline=Date.now()+100000;
  while(Date.now()<deadline){
    try{
      const res=await fetch(base+"/health",{signal:AbortSignal.timeout(1800)});
      if(res.status===200)return;
    }catch{}
    await new Promise(done=>setTimeout(done,1100));
  }
  throw Error("Generated application did not become healthy");
}
async function call(role,method,path,body,expected){
  const res=await fetch(base+path,{method,headers:{
    Authorization:auth(role),...(body===undefined?{}:{"Content-Type":"application/json"})
  },...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(18000)});
  const raw=await res.text();let data;
  try{data=JSON.parse(raw);}catch{data=raw;}
  assert.equal(res.status,expected,method+" "+path+" status="+res.status+" body="+JSON.stringify(data));
  return data;
}
if(mode==="prepare"){
  if(process.argv.length!==4)throw Error("Usage: r4-evolution-exercise.mjs prepare <rehydrated-TypeSpec-project>");
  const file=join(resolve(process.argv[3]),"contracts/main.tsp");
  const original=readFileSync(file,"utf8");
  const anchor="    lastReviewedAt?: utcDateTime | null;";
  assert.equal(original.split(anchor).length-1,2,"Require two canonical tool model/request anchors");
  const addition="    @maxLength(140)\n    serviceNote?: string | null;\n\n";
  const updated=original.replaceAll(anchor,addition+anchor);
  assert.equal(updated.split("serviceNote?: string | null;").length-1,2);
  writeFileSync(file,updated);
  console.log("PROTOCOLIA_R4_REHYDRATED_ADDITIVE_CONTRACT_READY");
}else if(mode==="seed"){
  await waitForHealthy();
  await call("manager","POST","/api/tools",{code:"R4-T1",name:"Torque wrench",quantity:7},201);
  await call("manager","POST","/api/tools",{code:"R4-T2",name:"Diagnostic probe",quantity:11},201);
  const row=await call("reader","GET","/api/tools/R4-T1",undefined,200);
  assert.equal(row.quantity,7);
  assert.equal(row.name,"Torque wrench");
  await call("reader","POST","/api/tools",{code:"R4-NO",name:"Not allowed",quantity:1},403);
  await call("manager","POST","/api/tools",{code:"R4-T1",name:"Duplicate",quantity:3},409);
  console.log("PROTOCOLIA_R4_PRE_EVOLUTION_PERSISTENT_ROWS_PASS");
}else if(mode==="verify"){
  await waitForHealthy();
  for(const [code,name,quantity]of [
    ["R4-T1","Torque wrench",7],["R4-T2","Diagnostic probe",11]]){
    const row=await call("reader","GET","/api/tools/"+code,undefined,200);
    assert.equal(row.name,name);assert.equal(row.quantity,quantity);
    assert.equal(row.serviceNote??null,null);
  }
  const added=await call("manager","POST","/api/tools",{
    code:"R4-T3",name:"Current clamp",quantity:4,serviceNote:"Verified after handoff"
  },201);
  assert.equal(added.serviceNote,"Verified after handoff");
  const changed=await call("manager","PATCH","/api/tools/R4-T1/quantity",{amount:2},200);
  assert.equal(changed.quantity,9);
  await call("reader","POST","/api/tools",{
    code:"R4-NO",name:"Still forbidden",quantity:1,serviceNote:"forbidden"
  },403);
  await call("manager","POST","/api/tools",{code:"R4-T2",name:"Duplicate",quantity:1},409);
  console.log("PROTOCOLIA_R4_POST_EVOLUTION_ROWS_AND_NEW_FIELD_PASS");
}else if(mode==="persist"){
  await waitForHealthy();
  const expected=[["R4-T1","Torque wrench",9,null],
    ["R4-T2","Diagnostic probe",11,null],
    ["R4-T3","Current clamp",4,"Verified after handoff"]];
  for(const [code,name,quantity,serviceNote]of expected){
    const row=await call("reader","GET","/api/tools/"+code,undefined,200);
    assert.equal(row.name,name);assert.equal(row.quantity,quantity);
    assert.equal(row.serviceNote??null,serviceNote);
  }
  console.log("PROTOCOLIA_R4_POST_RESTART_PERSISTENT_DATA_PASS");
}else{
  throw Error("Usage: r4-evolution-exercise.mjs prepare|seed|verify|persist [project]");
}
