#!/usr/bin/env node
// Independent RS256/JWKS resource-server oracle against a freshly generated application.
// All keys, users, containers and data are disposable; no external identity provider is contacted.
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes,sign} from "node:crypto";
import {spawnSync} from "node:child_process";
import {createServer as httpServer} from "node:http";
import {createServer as netServer} from "node:net";
import {existsSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";

const generated=resolve(process.argv[2]??"");
assert.ok(process.argv[2],"Generated application directory required");
const project="s1d2b_jwt_"+randomBytes(4).toString("hex");
const temp=mkdtempSync(join(tmpdir(),"protocolia-jwt-oracle-"));
const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const issuer="https://issuer.protocolia.test",audience="protocolia-generated-api";
const publicJwk={...publicKey.export({format:"jwk"}),kid:"protocolia-oracle-key",alg:"RS256",use:"sig"};
const b64=value=>Buffer.from(typeof value==="string"?value:JSON.stringify(value)).toString("base64url");
function jwt({sub="alice",iss=issuer,aud=audience,iat=Math.floor(Date.now()/1000),
  exp=iat+1800,nbf=iat-5,protocolia_capabilities=["notes.read"],header={}}={}){
 const h={alg:"RS256",typ:"JWT",kid:publicJwk.kid,...header};
 const claims={sub,iss,aud,iat,nbf,...(exp===null?{}:{exp}),protocolia_capabilities};
 const wire=b64(h)+"."+b64(claims);
 return wire+"."+sign("RSA-SHA256",Buffer.from(wire),privateKey).toString("base64url");
}
async function freePort(){return await new Promise((ok,fail)=>{
 const server=netServer();server.once("error",fail);
 server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(()=>ok(port));});
});}
function docker(args,timeout=600000){
 const r=spawnSync("docker",args,{cwd:generated,encoding:"utf8",timeout});
 if(r.status!==0||r.error)throw Error("Docker failure "+args.join(" ")+"\n"+(r.stderr??r.error?.message??"").slice(-1600));
 return r.stdout;
}
let server,running=false,args=[];
try{
 const [appPort,keyPort]=await Promise.all([freePort(),freePort()]);
 server=httpServer((request,response)=>{
   if(request.url!=="/.well-known/jwks.json"){response.writeHead(404);response.end();return;}
   response.setHeader("Content-Type","application/json");
   response.end(JSON.stringify({keys:[publicJwk]}));
 });
 await new Promise((ok,fail)=>server.once("error",fail).listen(keyPort,"0.0.0.0",ok));
 const env=join(temp,"env"),override=join(temp,"override.yaml");
 writeFileSync(env,[
  "PROTOCOLIA_DB_PASSWORD="+randomBytes(20).toString("hex"),
  "PROTOCOLIA_AUTH_MODE=jwt",
  "PROTOCOLIA_ALLOW_DEMO_AUTH=false",
  "PROTOCOLIA_JWT_ISSUER="+issuer,
  "PROTOCOLIA_JWT_AUDIENCE="+audience,
  "PROTOCOLIA_JWT_JWKS_URI=http://host.docker.internal:"+keyPort+"/.well-known/jwks.json",
  "PROTOCOLIA_JWT_ALLOW_TEST_HTTP=true",
  "PROTOCOLIA_READER_USERNAME=not-enabled-reader",
  "PROTOCOLIA_READER_PASSWORD="+randomBytes(20).toString("hex"),
  "PROTOCOLIA_MANAGER_USERNAME=not-enabled-manager",
  "PROTOCOLIA_MANAGER_PASSWORD="+randomBytes(20).toString("hex"),
  "PROTOCOLIA_HOST_PORT="+appPort
 ].join("\n")+"\n",{mode:0o600});
 writeFileSync(override,'services:\n  app:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n');
 args=["compose","-f",join(generated,"compose.yaml"),"-f",override,
  "--project-name",project,"--env-file",env];
 docker([...args,"config","--quiet"],15000);running=true;
 docker([...args,"up","--detach","--build"]);
 const base="http://127.0.0.1:"+appPort;
 let healthy=false;
 const deadline=Date.now()+130000;
 while(Date.now()<deadline){
  try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(2500)})).status===200){healthy=true;break;}}catch{}
  await new Promise(ok=>setTimeout(ok,1000));
 }
 assert.ok(healthy,"Generated JWT app failed to boot");
 async function req(path,{token,method="GET",body,headers={}}={}){
  const response=await fetch(base+path,{
   method,headers:{...(token?{Authorization:"Bearer "+token}:{}),
     ...(body===undefined?{}:{"Content-Type":"application/json"}),...headers},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)});
  const wire=await response.text();let data;try{data=JSON.parse(wire)}catch{data=wire}
  return {status:response.status,body:data};
 }
 assert.equal((await req("/health")).status,200);
 assert.equal((await req("/api/_protocolia/me")).status,401);
 assert.equal((await req("/api/_protocolia/me",{headers:{Authorization:"Basic "+b64("user:password")}})).status,401);
 const now=Math.floor(Date.now()/1000);
 const valid=jwt({sub:"alice",protocolia_capabilities:["notes.write","notes.read","notes.title.write","notes.private.read"]});
 const limited=jwt({sub:"bob",protocolia_capabilities:["notes.read","notes.private.read"]});
 const readOnly=jwt({sub:"charlie",protocolia_capabilities:["notes.read"]});
 const badTokens=[
   jwt({iss:"https://attacker.invalid"}),
   jwt({aud:"unrelated-service"}),
   jwt({exp:now-500,iat:now-800}),
   jwt({exp:null}),
   jwt({nbf:now+3600}),
   jwt({protocolia_capabilities:["notes.nonexistent"]}),
   jwt({protocolia_capabilities:["notes.read","notes.read"]}),
   jwt({protocolia_capabilities:["notes.read","public"]}),
   jwt({sub:""}),
   jwt({header:{kid:"untrusted-key"}}),
   valid.slice(0,-4)+"AAAA",
   b64({alg:"none",typ:"JWT"})+"."+b64({iss:issuer,aud:audience,sub:"alice",iat:now,exp:now+1000,
      protocolia_capabilities:["notes.write"]})+"."
 ];
 for(let i=0;i<badTokens.length;i++){
  const r=await req("/api/_protocolia/me",{token:badTokens[i]});
  assert.equal(r.status,401,"Invalid JWT #"+i+" accepted: "+JSON.stringify(r.body));
 }
 const session=await req("/api/_protocolia/me",{token:valid});
 assert.equal(session.status,200,JSON.stringify(session));
 assert.equal(session.body.username,"alice");
 assert.deepEqual(session.body.capabilities,["notes.private.read","notes.read","notes.title.write","notes.write"]);
 const note="jwt-"+randomBytes(5).toString("hex");
 const created=await req("/api/notes",{method:"POST",token:valid,
  body:{noteCode:note,title:"JWT private row",privateMemo:"Protected by signed claims"}});
 assert.equal(created.status,201,JSON.stringify(created));
 assert.equal(created.body.owner,"alice");
 assert.equal(created.body.privateMemo,"Protected by signed claims");
 assert.equal((await req("/api/notes/"+note,{token:limited})).status,404);
 assert.equal((await req("/api/notes",{method:"POST",token:limited,
  body:{noteCode:note+"-illegal",title:"No writer"}})).status,403);
 assert.equal((await req("/api/notes/"+note+"/title",{method:"PATCH",token:limited,
  body:{title:"No patch"}})).status,403);
 const bob="jwt-bob-"+randomBytes(5).toString("hex");
 const charlie="jwt-charlie-"+randomBytes(5).toString("hex");
 docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia","-v","ON_ERROR_STOP=1","-c",
  "INSERT INTO private_note(note_code,owner,title,private_memo) VALUES ('"+bob+"','bob','Bob row','Bob private'),('"+charlie+"','charlie','Charlie row','Charlie private')"],15000);
 const b=await req("/api/notes/"+bob,{token:limited}),c=await req("/api/notes/"+charlie,{token:readOnly});
 assert.equal(b.status,200);assert.equal(b.body.privateMemo,"Bob private");
 assert.equal(c.status,200);assert.equal(Object.hasOwn(c.body,"privateMemo"),false);
 const bp=await req("/api/notes?limit=25&offset=0",{token:limited});
 assert.equal(bp.body.total,1);assert.equal(bp.body.items[0].privateMemo,"Bob private");
 const cp=await req("/api/notes?limit=25&offset=0",{token:readOnly});
 assert.equal(cp.body.total,1);assert.equal(Object.hasOwn(cp.body.items[0],"privateMemo"),false);
 const forged=await req("/api/notes/"+bob+"/title",{token:limited,method:"PATCH",
  headers:{"X-ProtocolIA-Capabilities":"notes.title.write"},body:{title:"Escalate"}});
 assert.equal(forged.status,403);
 const changed=await req("/api/notes/"+note+"/title",{token:valid,method:"PATCH",body:{title:"Edited securely"}});
 assert.equal(changed.status,200);
 assert.equal((await req("/api/notes/"+note,{token:valid})).body.title,"Edited securely");
 assert.equal((await req("/api/notes/"+bob,{token:valid})).status,404);
 // Explicitly refuse to run demo and bearer modes at the same time.
 const incompatible=spawnSync("docker",[...args,"run","--rm","--no-deps","-e",
   "PROTOCOLIA_ALLOW_DEMO_AUTH=true","app"],{cwd:generated,encoding:"utf8",timeout:60000});
 assert.notEqual(incompatible.status,0,"JWT + Basic demo mode must not start");
 assert.match((incompatible.stdout??"")+"\n"+(incompatible.stderr??""),
   /JWT mode cannot enable demo credentials|Demo credentials forbidden in JWT mode/);
 console.log("PROTOCOLIA_S1D2B_JWT_PASS "+JSON.stringify({
  signedRS256:true,issuerAudienceRequired:true,expiredAndFutureDenied:true,
  missingClaimsDenied:true,unknownAndDuplicateCapabilitiesDenied:true,
  untrustedKeyDenied:true,basicRejected:true,serverOwnership:true,
  rowAndFieldScopes:true,privilegeEscalationDenied:true,mutuallyExclusiveAuthModes:true
 }));
}finally{
 if(running)try{docker([...args,"down","--volumes","--remove-orphans"],120000)}
 catch(error){console.error(error.message);process.exitCode=1;}
 if(server)await new Promise(ok=>server.close(ok));
 rmSync(temp,{recursive:true,force:true});
}
