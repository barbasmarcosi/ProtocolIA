#!/usr/bin/env node
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";

assert.ok(process.argv[2],"Supply generated app directory");
const dir=resolve(process.argv[2]),work=mkdtempSync(join(tmpdir(),"pia-b17-ver-"));
const project="pia_b17v_"+randomBytes(5).toString("hex");
const schema=readFileSync(existsSync(join(dir,"src/schema.sql"))?
  join(dir,"src/schema.sql"):join(dir,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
assert.match(schema,/document_version INTEGER NOT NULL DEFAULT 1 CHECK \(document_version >= 1\)/);
const secret=randomBytes(20).toString("hex"),readerPass=randomBytes(20).toString("hex"),scopedPass=randomBytes(20).toString("hex");
const basic=(u,p)=>"Basic "+Buffer.from(u+":"+p).toString("base64");
function docker(params,timeout=180000){
  const r=spawnSync("docker",params,{cwd:dir,encoding:"utf8",timeout});
  if(r.status!==0||r.error)throw Error("Docker failed: "+params.join(" ")+" "+(r.stderr??r.error?.message??"").slice(-1400));
  return r.stdout.trim();
}
const openPort=()=>new Promise((done,fail)=>{const s=createServer();
  s.once("error",fail);s.listen(0,"127.0.0.1",()=>{
    const n=s.address().port;s.close(()=>done(n));
  });
});
let args=[],started=false;
try{
  const number=await openPort(),env=join(work,".env");
  writeFileSync(env,[
    "PROTOCOLIA_DB_PASSWORD="+randomBytes(20).toString("hex"),
    "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
    "PROTOCOLIA_MANAGER_USERNAME=manager","PROTOCOLIA_MANAGER_PASSWORD="+secret,
    "PROTOCOLIA_READER_USERNAME=reader","PROTOCOLIA_READER_PASSWORD="+readerPass,
    "PROTOCOLIA_SCOPED_USERNAME=child_writer","PROTOCOLIA_SCOPED_PASSWORD="+scopedPass,
    "PROTOCOLIA_SCOPED_CAPABILITIES=orders.read,lines.read,lines.write",
    "PROTOCOLIA_HOST_PORT="+number
  ].join("\n")+"\n",{mode:0o600});
  args=["compose","--project-name",project,"--env-file",env];
  docker([...args,"config","--quiet"],20000);
  started=true;
  docker([...args,"up","--detach","--build"],600000);
  const base="http://127.0.0.1:"+number;
  let ready=false;
  for(let i=0;i<120;i++){
    try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(2400)})).ok){ready=true;break;}}catch{}
    await new Promise(done=>setTimeout(done,900));
  }
  assert.ok(ready,"Generated versioned app must be healthy");
  async function req(method,path,body,headers={}){
    const res=await fetch(base+path,{method,headers:{
      Authorization:basic("manager",secret),
      ...(body===undefined?{}:{"Content-Type":"application/json"}),...headers
    },...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
    const raw=await res.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
    return {status:res.status,body:data,etag:res.headers.get("etag")};
  }
  const line=(lineCode,units=1)=>({lineCode,product:"Producto",units});
  const create=await req("POST","/api/orders",{
    code:"VERSIONED",title:"Orden con version",lines:[line("INITIAL")]
  });
  assert.equal(create.status,201,JSON.stringify(create));
  assert.equal(create.body.documentVersion,1);
  assert.equal(create.etag,'"1"');
  const header=async()=>req("GET","/api/orders/VERSIONED");
  const append=(lineCode,tag)=>req("POST","/api/order-lines",
    {...line(lineCode),orderCode:"VERSIONED"},tag?{"If-Match":tag}:{});
  const patch=(units,expected,tag)=>req("PATCH","/api/order-lines/INITIAL/units",
    {units,expected},tag?{"If-Match":tag}:{});
  assert.equal((await header()).etag,'"1"');
  assert.equal((await append("NO-IFMATCH")).status,400);
  for(const invalid of ['*','1','W/"1"','"0"','"2147483648"'])
    assert.equal((await append("BAD-"+invalid.replace(/[^A-Za-z0-9]/g,"").slice(0,12),invalid)).status,400);
  assert.equal((await req("POST","/api/order-lines",
    {...line("UNAUTHORIZED"),orderCode:"VERSIONED"},
    {"If-Match":'"1"',Authorization:basic("child_writer",scopedPass)})).status,403);
  assert.equal((await append("ADDED",'"1"')).status,201);
  assert.equal((await append("STALE",'"1"')).status,409);
  assert.equal((await header()).body.documentVersion,2);
  const race=await Promise.all([append("RACE-ONE",'"2"'),append("RACE-TWO",'"2"')]);
  assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);
  assert.equal((await header()).body.documentVersion,3);
  assert.equal((await patch(5,1)).status,400);
  assert.equal((await patch(5,1,'"2"')).status,409);
  assert.equal((await patch(5,1,'"3"')).status,200);
  assert.equal((await header()).body.documentVersion,4);
  const product=await req("PATCH","/api/order-lines/INITIAL/product",
    {product:"Nuevo",expected:"Producto"},{"If-Match":'"4"'});
  assert.equal(product.status,200,JSON.stringify(product));
  assert.equal((await header()).body.documentVersion,5);
  const cross=await Promise.all([patch(7,5,'"5"'),append("CROSS-NEW",'"5"')]);
  assert.ok((cross[0].status===200&&cross[1].status===409)||
    (cross[0].status===409&&cross[1].status===201),
    "Append vs patch must have one winner: "+JSON.stringify(cross.map(x=>x.status)));
  const parent=await header();
  assert.equal(parent.body.documentVersion,6);
  assert.equal(parent.etag,'"6"');
  const sql=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT document_version::text || ':' || "+
      "(SELECT count(*) FROM order_line WHERE order_code='VERSIONED')::text "+
      "FROM purchase_order WHERE code='VERSIONED'"]);
  assert.match(sql,/^6:[34]$/);
  const rejects=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT count(*)::text FROM order_line WHERE line_code IN "+
      "('NO-IFMATCH','STALE','UNAUTHORIZED')"]);
  assert.equal(rejects,"0");
  console.log("PROTOCOLIA_B17_VERSIONED_DETAILS_PASS "+JSON.stringify({
    persisted:true,strongIfMatch:true,staleAppendConflict:true,concurrentAppendOneWinner:true,
    auditedPatchVersioned:true,appendVsPatchOneWinner:true,versionEtag:true,parentPermission:true
  }));
}finally{
  if(started)try{docker([...args,"down","--volumes","--remove-orphans"],120000);}catch(e){console.error(String(e));}
  rmSync(work,{recursive:true,force:true});
}
