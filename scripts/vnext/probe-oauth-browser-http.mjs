#!/usr/bin/env node
// Disposable OAuth2 provider: real PKCE verification, signed RS256 JWT and Chromium login.
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,randomBytes,sign} from "node:crypto";
import {spawnSync} from "node:child_process";
import {createServer as httpServer} from "node:http";
import {createServer as netServer} from "node:net";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
const generated=resolve(process.argv[2]??"");
assert.ok(process.argv[2],"Generated app directory is required");
const project="s1pkce_"+randomBytes(4).toString("hex");
const temp=mkdtempSync(join(tmpdir(),"protocolia-pkce-browser-"));
const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
let issuer="";const audience="protocolia-generated-api";
const key={...publicKey.export({format:"jwk"}),kid:"pkce-test-key",alg:"RS256",use:"sig"};
const b64=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
function identityToken(nonce,access,overrides={}){
 const now=Math.floor(Date.now()/1000);
 const claims={iss:issuer,aud:"protocolia-browser",sub:"alice",nonce,
   iat:now,exp:now+1200,
   at_hash:createHash("sha256").update(access).digest().subarray(0,16).toString("base64url"),
   ...overrides};
 const unsigned=b64({alg:"RS256",typ:"JWT",kid:key.kid})+"."+b64(claims);
 return unsigned+"."+sign("RSA-SHA256",Buffer.from(unsigned),privateKey).toString("base64url");
}
function token(subject="alice"){
 const now=Math.floor(Date.now()/1000),h={alg:"RS256",typ:"JWT",kid:key.kid};
 const claims={iss:issuer,aud:audience,sub:subject,iat:now,exp:now+1200,
   protocolia_capabilities:["notes.read","notes.write","notes.title.write","notes.private.read"]};
 const unsigned=b64(h)+"."+b64(claims);
 return unsigned+"."+sign("RSA-SHA256",Buffer.from(unsigned),privateKey).toString("base64url");
}
async function freePort(){return await new Promise((ok,fail)=>{
 const server=netServer();server.once("error",fail);
 server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(()=>ok(port));});
});}
function docker(args,timeout=600000){
 const result=spawnSync("docker",args,{cwd:generated,encoding:"utf8",timeout});
 if(result.status!==0||result.error)throw Error("Docker error: "+
   (result.stderr??result.error?.message??"").slice(-2400));
 return result.stdout;
}
const pending=new Map();let exchanges=0,validPkce=false;
let discoveryMode="wrongIssuer";
let provider,running=false,args=[];
try{
 const [appPort,idpPort]=await Promise.all([freePort(),freePort()]);
 const base="http://127.0.0.1:"+appPort,callback=base+"/";
 issuer="http://host.docker.internal:"+idpPort;
 provider=httpServer(async(req,res)=>{
  const url=new URL(req.url??"/","http://127.0.0.1:"+idpPort);
  if(url.pathname==="/.well-known/openid-configuration"){
   res.setHeader("Content-Type","application/json");
   res.setHeader("Cache-Control","no-store");
   res.end(JSON.stringify({
     issuer:discoveryMode==="wrongIssuer"?"https://untrusted-idp.example":issuer,
     authorization_endpoint:"http://127.0.0.1:"+idpPort+"/authorize",
     token_endpoint:"http://127.0.0.1:"+idpPort+"/token",
     jwks_uri:"http://host.docker.internal:"+idpPort+"/jwks",
     response_types_supported:["code"],
     code_challenge_methods_supported:["S256"],
     authorization_response_iss_parameter_supported:true
   }));return;
  }
  if(url.pathname==="/jwks"){
   res.setHeader("Content-Type","application/json");
   res.end(JSON.stringify({keys:[key]}));return;
  }
  if(url.pathname==="/authorize"){
   const p=url.searchParams;
   if(req.method!=="GET"||p.get("response_type")!=="code"||
      p.get("client_id")!=="protocolia-browser"||
      p.get("redirect_uri")!==callback||p.get("code_challenge_method")!=="S256"||
      !/^[A-Za-z0-9_-]{43,}$/.test(p.get("code_challenge")??"")||
      !/^[A-Za-z0-9_-]{43,}$/.test(p.get("state")??"")||
     !/^[A-Za-z0-9_-]{43,}$/.test(p.get("nonce")??"")){
     res.writeHead(400);res.end("Invalid authorization request");return;
   }
   const code=randomBytes(24).toString("hex");
   pending.set(code,{challenge:p.get("code_challenge"),nonce:p.get("nonce")});
   res.writeHead(302,{Location:callback+"?code="+code+"&state="+encodeURIComponent(p.get("state"))+
     "&iss="+encodeURIComponent(issuer),"Cache-Control":"no-store"});
   res.end();return;
  }
  if(url.pathname==="/token"){
   res.setHeader("Access-Control-Allow-Origin",base);
   res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
   res.setHeader("Access-Control-Allow-Headers","Content-Type");
   res.setHeader("Cache-Control","no-store");
   if(req.method==="OPTIONS"){res.writeHead(204);res.end();return;}
   let raw="";for await(const chunk of req)raw+=chunk.toString();
   const p=new URLSearchParams(raw),code=p.get("code"),transaction=pending.get(code);
   const challenge=transaction?.challenge;
   pending.delete(code);
   const proof=createHash("sha256").update(p.get("code_verifier")??"").digest("base64url");
   if(!challenge||proof!==challenge||p.get("grant_type")!=="authorization_code"||
      p.get("redirect_uri")!==callback||p.get("client_id")!=="protocolia-browser"){
     res.writeHead(400);res.end("Invalid or replayed PKCE code");return;
   }
   validPkce=true;exchanges++;
   res.setHeader("Content-Type","application/json");
   const access=token();
   res.end(JSON.stringify({access_token:access,token_type:"Bearer",
     id_token:identityToken(transaction.nonce,access),expires_in:1200}));return;
  }
  res.writeHead(404);res.end();
 });
 await new Promise((ok,fail)=>provider.once("error",fail).listen(idpPort,"0.0.0.0",ok));
 const envFile=join(temp,".env"),composeOverride=join(temp,"compose-override.yaml");
 writeFileSync(envFile,[
   "PROTOCOLIA_DB_PASSWORD="+randomBytes(20).toString("hex"),
   "PROTOCOLIA_AUTH_MODE=jwt",
   "PROTOCOLIA_ALLOW_DEMO_AUTH=false",
   "PROTOCOLIA_JWT_ISSUER="+issuer,
   "PROTOCOLIA_JWT_AUDIENCE="+audience,
   "PROTOCOLIA_JWT_JWKS_URI=http://host.docker.internal:"+idpPort+"/jwks",
   "PROTOCOLIA_JWT_ALLOW_TEST_HTTP=true",
   "PROTOCOLIA_OIDC_DISCOVERY_REQUIRED=true",
   "PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED=true",
   "PROTOCOLIA_OIDC_AUTHORIZATION_ENDPOINT=http://127.0.0.1:"+idpPort+"/authorize",
   "PROTOCOLIA_OIDC_TOKEN_ENDPOINT=http://127.0.0.1:"+idpPort+"/token",
   "PROTOCOLIA_OIDC_CLIENT_ID=protocolia-browser",
   "PROTOCOLIA_OIDC_REDIRECT_URI="+callback,
   "PROTOCOLIA_READER_USERNAME=unused-reader",
   "PROTOCOLIA_READER_PASSWORD="+randomBytes(20).toString("hex"),
   "PROTOCOLIA_MANAGER_USERNAME=unused-manager",
   "PROTOCOLIA_MANAGER_PASSWORD="+randomBytes(20).toString("hex"),
   "PROTOCOLIA_HOST_PORT="+appPort
 ].join("\n")+"\n",{mode:0o600});
 writeFileSync(composeOverride,'services:\n  app:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n');
 args=["compose","-f",join(generated,"compose.yaml"),"-f",composeOverride,
   "--project-name",project,"--env-file",envFile];
 docker([...args,"config","--quiet"],15000);running=true;
 docker([...args,"up","--detach","--build"]);
 let rejected=false;
 const negativeUntil=Date.now()+70000;
 while(Date.now()<negativeUntil){
   const logs=docker([...args,"logs","--no-color","app"],15000);
   if(logs.includes("OIDC discovery metadata mismatch: issuer")){rejected=true;break;}
   await new Promise(ok=>setTimeout(ok,900));
 }
 assert.ok(rejected,"Generated backend must reject mismatched OIDC issuer before serving traffic");
 discoveryMode="valid";
 docker([...args,"up","--detach","--force-recreate","app"],180000);
 let healthy=false;
 const until=Date.now()+130000;
 while(Date.now()<until){
  try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(2000)})).status===200){healthy=true;break;}}catch{}
  await new Promise(ok=>setTimeout(ok,1000));
 }
 assert.ok(healthy,"JWT generated app did not become healthy");
 const config=await (await fetch(base+"/api/_protocolia/auth/config")).json();
 assert.equal(config.mode,"jwt");assert.equal(config.enabled,true);
 assert.equal(config.redirectUri,callback);
 assert.equal(config.requireIssuerResponse,true);
 assert.equal(config.requireIdToken,true);
 // Distinct real signed ID tokens never grant API privileges by themselves.
 const nonce=randomBytes(32).toString("base64url");
 const bearer=token();
 const path=base+"/api/_protocolia/me";
 const getSession=async(proof,challenge=nonce)=>await fetch(path,{headers:{
   Authorization:"Bearer "+bearer,
   "X-ProtocolIA-ID-Token":proof,
   "X-ProtocolIA-OIDC-Nonce":challenge
 }});
 assert.equal((await getSession(identityToken(nonce,bearer))).status,200);
 for(const options of [
   [{nonce:"wrong-"+nonce}],
   [{aud:"wrong-client"}],
   [{sub:"mallory"}],
   [{iss:"https://evil.example"}],
   [{at_hash:"forged"}],
   [{iat:Math.floor(Date.now()/1000)-4000}]
 ]){
   const invalid=identityToken(nonce,bearer,options[0]);
   assert.equal((await getSession(invalid)).status,401,
     "Incorrect signed ID token claims must be refused");
 }
 assert.equal((await getSession(identityToken(nonce,bearer),randomBytes(32).toString("base64url"))).status,401);
 const goodIdentity=identityToken(nonce,bearer);
 const segments=goodIdentity.split(".");
 segments[2]=(segments[2][0]==="A"?"B":"A")+segments[2].slice(1);
 const broken=segments.join(".");
 assert.equal((await getSession(broken)).status,401,"Bad ID token signature must be rejected");
 assert.equal((await getSession("")).status,401,"Missing ID token rejected");
 const {chromium}=await import("playwright");
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(callback,{waitUntil:"domcontentloaded"});
  await page.getByTestId("login-provider").waitFor({timeout:15000});
  assert.equal(await page.getByTestId("username").count(),0);
  await page.getByTestId("login-provider").click();
  await page.getByTestId("open-create").waitFor({timeout:20000});
  assert.equal(exchanges,1,"Exactly one PKCE exchange required");
  assert.ok(validPkce);
  assert.ok(!page.url().includes("code="),"Callback codes must not survive in URL");
  const stored=await page.evaluate(()=>({
    local:Object.keys(localStorage),session:Object.keys(sessionStorage)
  }));
  assert.ok(!stored.local.some(name=>/token|oauth/i.test(name)));
  assert.ok(!stored.session.some(name=>/pkce|oauth/i.test(name)));
  await page.getByTestId("open-create").click();
  const form=page.getByTestId("create-form-PrivateNote");
  const code="oauth-"+randomBytes(5).toString("hex");
  await form.getByTestId("create-noteCode").fill(code);
  await form.getByTestId("create-title").fill("Created after PKCE");
  const posting=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/notes");
  await form.getByRole("button",{name:"Crear",exact:true}).click();
  assert.equal((await posting).status(),201);
  const detail=await fetch(base+"/api/notes/"+code,{headers:{Authorization:"Bearer "+token()}});
  assert.equal(detail.status,200);
  assert.equal((await detail.json()).owner,"alice");
  // Exercise an actual protected request from the generated UI.
  // The 401 must clear in-memory credentials and show a new login.
  await page.route(url=>new URL(url).pathname==="/api/notes",async route=>{
    if(route.request().method()==="GET")
      await route.fulfill({status:401,contentType:"application/json",body:"{}"});
    else await route.continue();
  });
  await page.getByRole("button",{name:"Actualizar",exact:true}).click();
  await page.getByTestId("login-provider").waitFor({timeout:10000});
  await page.getByRole("alert").getByText(/sesión expiró|ya no es válida/).waitFor();
  assert.equal(await page.getByTestId("open-create").count(),0);
  await page.unrouteAll();
  // Logging back in is possible, and late 401 events from prior credentials
  // must not invalidate a different authenticated session.
  await page.getByTestId("login-provider").click();
  await page.getByTestId("open-create").waitFor({timeout:20000});
  assert.equal(exchanges,2,"The browser should perform a second real PKCE exchange");
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent("protocolia:auth-rejected",{
    detail:{authorization:"Bearer stale-previous-session"}
  })));
  assert.equal(await page.getByTestId("open-create").count(),1);
  await page.getByRole("button",{name:"Cerrar sesión"}).click();
  await page.goto(callback+"?code=forged&state=wrong",{waitUntil:"domcontentloaded"});
  await page.getByRole("alert").getByText(/expiró|utilizada|no válida/i).waitFor();
  assert.equal(await page.getByTestId("open-create").count(),0);
  assert.ok(!page.url().includes("code=forged"));
  assert.equal(exchanges,2,"Forged callback must not exchange");
  assert.deepEqual(errors,[]);
  await page.screenshot({path:join(generated,"s1-oauth-pkce-mobile.png"),fullPage:true});
 }finally{await browser.close();}
 console.log("PROTOCOLIA_S1D2C_PKCE_BROWSER_PASS "+JSON.stringify({
   realCodeVerifier:true,codeSingleUse:true,serverJWKS:true,
   signedAccessToken:true,callbackState:true,noTokenStorage:true,
   forgedCallbackRejected:true,generatedCreate:true,mobile:true,
   protectedRequest401EndsSession:true,reauthentication:true,stale401Isolated:true,
   oidcDiscoveryBound:true,issuerMismatchFailsStartup:true,issuerResponseRequired:true,
   signedIdToken:true,nonceBinding:true,subjectAndAudienceValidated:true,atHashValidated:true
 }));
}finally{
 if(running)try{docker([...args,"down","--volumes","--remove-orphans"],120000)}
 catch(error){console.error(error.message);process.exitCode=1;}
 if(provider)await new Promise(ok=>provider.close(ok));
 rmSync(temp,{recursive:true,force:true});
}
