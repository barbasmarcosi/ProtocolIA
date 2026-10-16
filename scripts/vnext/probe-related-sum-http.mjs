#!/usr/bin/env node
// B2.4a acceptance: both real generated backends, PostgreSQL and concurrent reserve/release.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";

assert.ok(process.argv[2],"Usage: probe-related-sum-http.mjs generated-project");
const root=resolve(process.argv[2]),tag=randomBytes(5).toString("hex");
const folder=mkdtempSync(join(tmpdir(),"protocolia-b2-rel-sum-"));
const user="manager_"+tag,read="reader_"+tag,secret=randomBytes(18).toString("hex"),
  readSecret=randomBytes(18).toString("hex");
const authorization=(name,password)=>"Basic "+Buffer.from(name+":"+password).toString("base64");
const cmd=(args,timeout=600000)=>{
  const x=spawnSync("docker",args,{cwd:root,encoding:"utf8",timeout});
  if(x.status!==0||x.error)throw Error("docker command failed: "+args.join(" ")+"\n"+String(x.stderr??x.error).slice(-1400));
  return x.stdout;
};
const port=()=>new Promise((resolve,reject)=>{
  const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{
    const n=s.address().port;s.close(()=>resolve(n));
  });
});
let opts=[],started=false;
try{
 const number=await port(),env=join(folder,".env");
 writeFileSync(env,[
   "PROTOCOLIA_DB_PASSWORD="+randomBytes(20).toString("hex"),
   "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
   "PROTOCOLIA_MANAGER_USERNAME="+user,
   "PROTOCOLIA_MANAGER_PASSWORD="+secret,
   "PROTOCOLIA_READER_USERNAME="+read,
   "PROTOCOLIA_READER_PASSWORD="+readSecret,
   "PROTOCOLIA_HOST_PORT="+number
 ].join("\n")+"\n",{mode:0o600});
 opts=["compose","--project-name","b24_"+tag,"--env-file",env];
 cmd([...opts,"config","--quiet"],15000);started=true;
 cmd([...opts,"up","--detach","--build"]);
 const base="http://127.0.0.1:"+number;
 let healthy=false;
 for(let k=0;k<140;k++){
  try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(1500)})).status===200){
    healthy=true;break;
  }}catch{}
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(healthy,"Generated app must pass health");
 const call=async(method,url,{who="manager",body}={})=>{
  const res=await fetch(base+url,{method,headers:{
    ...(who==="manager"?{Authorization:authorization(user,secret)}:
      who==="reader"?{Authorization:authorization(read,readSecret)}:{}),
    ...(body===undefined?{}:{"Content-Type":"application/json"})
  },...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  const raw=await res.text();let parsed;
  try{parsed=JSON.parse(raw)}catch{parsed=raw}
  return {status:res.status,data:parsed};
 };
 const eq=async(status,method,url,options)=>{
  const r=await call(method,url,options);
  assert.equal(r.status,status,method+" "+url+" "+JSON.stringify(r.data));return r.data;
 };
 const stock="/api/parts",alloc="/api/allocations",id="P-"+tag;
 const summary=stock+"/"+id+"/allocation-summary";
 await eq(401,"GET",summary,{who:null});
 await eq(404,"GET",summary,{who:"reader"});
 await eq(201,"POST",stock,{body:{sku:id,name:"Example stock",available:10}});
 assert.deepEqual(await eq(200,"GET",summary,{who:"reader"}),{totalUnits:"0"});
 await eq(201,"POST",alloc,{body:{number:"A-"+tag,partSku:id,units:3,status:"active"}});
 assert.deepEqual(await eq(200,"GET",summary,{who:"reader"}),{totalUnits:"3"});
 assert.equal((await eq(200,"GET",stock+"/"+id,{who:"reader"})).available,7);
 await eq(409,"POST",alloc,{body:{number:"A-"+tag,partSku:id,units:2,status:"active"}});
 assert.deepEqual(await eq(200,"GET",summary,{who:"reader"}),{totalUnits:"3"});
 const requests=Array.from({length:10},(_,i)=>call("POST",alloc,{body:{
   number:"R-"+tag+"-"+i,partSku:id,units:1,status:"active"
 }}));
 const outcomes=await Promise.all(requests);
 assert.equal(outcomes.filter(r=>r.status===201).length,7,JSON.stringify(outcomes));
 assert.equal(outcomes.filter(r=>r.status===409).length,3,JSON.stringify(outcomes));
 assert.deepEqual(await eq(200,"GET",summary,{who:"reader"}),{totalUnits:"10"});
 assert.equal((await eq(200,"GET",stock+"/"+id,{who:"reader"})).available,0);
 // Exactly once release removes the cancelled row from the aggregate.
 const cancelled=await Promise.all(Array.from({length:4},()=>call("POST",alloc+"/A-"+tag+"/cancel")));
 assert.equal(cancelled.filter(r=>r.status===200).length,1);
 assert.equal(cancelled.filter(r=>r.status===409).length,3);
 assert.deepEqual(await eq(200,"GET",summary,{who:"reader"}),{totalUnits:"7"});
 assert.equal((await eq(200,"GET",stock+"/"+id,{who:"reader"})).available,3);
 // Concurrent readers see committed sums from a single MVCC snapshot.
 const snapshots=await Promise.all(Array.from({length:12},()=>call("GET",summary,{who:"reader"})));
 assert.ok(snapshots.every(r=>r.status===200&&r.data.totalUnits==="7"));
 await eq(403,"POST",alloc,{who:"reader",body:{number:"DENY-"+tag,partSku:id,units:1,status:"active"}});
 assert.deepEqual(await eq(200,"GET",summary,{who:"reader"}),{totalUnits:"7"});
 console.log("B2_4A_RELATED_SUM_MVCC_RESERVE_RELEASE_CONCURRENCY_PASS",JSON.stringify({target:process.argv[2],active:"7"}));
}finally{
 if(started)try{cmd([...opts,"down","--volumes","--remove-orphans"],120000)}
 catch(error){console.error("Clean-up failed",error.message);process.exitCode=1;}
 rmSync(folder,{recursive:true,force:true});
}
