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
const restartDuringOAuth=process.argv.includes("--restart-during-oauth");
const project="s1bff_"+randomBytes(4).toString("hex");
const temp=mkdtempSync(join(tmpdir(),"protocolia-bff-browser-"));
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
 const base="http://127.0.0.1:"+appPort,callback=base+"/api/_protocolia/bff/callback";
 issuer="http://host.docker.internal:"+idpPort;
 provider=httpServer(async(req,res)=>{
  const url=new URL(req.url??"/","http://127.0.0.1:"+idpPort);
  if(url.pathname==="/.well-known/openid-configuration"){
   res.setHeader("Content-Type","application/json");
   res.setHeader("Cache-Control","no-store");
   res.end(JSON.stringify({
     issuer:discoveryMode==="wrongIssuer"?"https://untrusted-idp.example":issuer,
     authorization_endpoint:"http://127.0.0.1:"+idpPort+"/authorize",
     token_endpoint:"http://host.docker.internal:"+idpPort+"/token",
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
      !/^[A-Za-z0-9_-]{32,128}={0,2}$/.test(p.get("state")??"")||
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
   "PROTOCOLIA_OIDC_TOKEN_ENDPOINT=http://host.docker.internal:"+idpPort+"/token",
   "PROTOCOLIA_OIDC_CLIENT_ID=protocolia-browser",
   "PROTOCOLIA_OIDC_REDIRECT_URI="+base+"/",
   "PROTOCOLIA_OIDC_BFF_REDIRECT_URI="+callback,
   "PROTOCOLIA_BFF_ENABLED=true",
   "PROTOCOLIA_BFF_CLEANUP_INTERVAL_MS=2000",
   "PROTOCOLIA_BFF_ENCRYPTION_KEY="+randomBytes(32).toString("hex"),
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
 assert.equal(config.mode,"bff");assert.equal(config.enabled,true);
 assert.equal(config.access_token,undefined,"No access token exposed by config");
 assert.equal(config.tokenEndpoint,undefined,"No token endpoint exposed by config");
 assert.equal((await fetch(base+"/api/_protocolia/me",{headers:{Authorization:"Bearer "+token()}})).status,401,
   "Client bearer authentication must be rejected in BFF mode");
 assert.deepEqual(await (await fetch(base+"/api/_protocolia/bff/session")).json(),{authenticated:false});
 const {chromium}=await import("playwright");
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
  const errors=[],bearerLeaks=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("request",r=>{
    if(new URL(r.url()).pathname.startsWith("/api/")&&r.headers().authorization)
      bearerLeaks.push(r.url());
  });
  await page.goto(base+"/",{waitUntil:"domcontentloaded"});
  await page.getByTestId("login-provider").waitFor({timeout:15000});
  if(restartDuringOAuth){
    // Freeze only the browser's IdP hop. The BFF has already issued its
    // PKCE authorization state and must commit JSESSIONID to PostgreSQL.
    await page.route("**/authorize?*",async route=>{await route.abort("blockedbyclient");});
    const intercepted=page.waitForRequest(r=>new URL(r.url()).pathname==="/authorize",{timeout:15000});
    await page.getByTestId("login-provider").click({noWaitAfter:true});
    const authorizationRequest=await intercepted;
    const pendingCookies=await page.context().cookies(base);
    assert.ok(pendingCookies.some(c=>c.name==="SESSION"&&c.httpOnly),
      "Spring Session JDBC must issue an HttpOnly SESSION cookie");
    const durableCount=Number(docker([...args,"exec","-T","db","psql",
      "-U","protocolia","-d","protocolia","-Atc",
      "SELECT COUNT(*) FROM SPRING_SESSION"],15000).trim());
    assert.ok(durableCount>=1,"Authorization PKCE state must be stored in PostgreSQL");
    docker([...args,"restart","app"],180000);
    let restored=false;
    const restartedUntil=Date.now()+90000;
    while(Date.now()<restartedUntil){
      try{
        if((await fetch(base+"/health",{signal:AbortSignal.timeout(2000)})).status===200){
          restored=true;break;
        }
      }catch{}
      await new Promise(ok=>setTimeout(ok,850));
    }
    assert.ok(restored,"Spring backend must restart with existing PostgreSQL login state");
    await page.unroute("**/authorize?*");
    await page.goto(authorizationRequest.url(),{waitUntil:"domcontentloaded"});
  }else{
    await page.getByTestId("login-provider").click();
  }
  try{await page.getByTestId("open-create").waitFor({timeout:15000});}
  catch(error){
    console.error("BFF_DIAGNOSTIC",JSON.stringify({
      url:page.url(),body:(await page.locator("body").innerText()).slice(0,1700),
      cookies:(await page.context().cookies()).map(c=>({name:c.name,httpOnly:c.httpOnly,sameSite:c.sameSite})),
      errors
    }));
    console.error("BFF_SERVER_DIAGNOSTIC",docker([...args,"logs","--no-color","app"],15000).slice(-9500));
    throw error;
  }
  assert.equal(exchanges,1,"Exactly one server PKCE exchange required");
  assert.ok(validPkce);
  assert.ok(!page.url().includes("code="));
  assert.equal(bearerLeaks.length,0,"Generated browser must never send access tokens");
  const storage=await page.evaluate(()=>({
    local:Object.keys(localStorage),session:Object.keys(sessionStorage),cookie:document.cookie
  }));
  assert.deepEqual(storage.local.filter(n=>/oauth|token/i.test(n)),[]);
  assert.deepEqual(storage.session.filter(n=>/oauth|pkce|token/i.test(n)),[]);
  assert.ok(!storage.cookie.includes("pia_bff"),"HttpOnly session must not be readable in JS");
  const cookies=await page.context().cookies();
  const sessionCookie=cookies.find(c=>c.name==="pia_bff_dev");
  assert.ok(sessionCookie?.httpOnly,"Session must use HttpOnly cookie");
  assert.equal(sessionCookie.sameSite,"Lax");
  const sessionResponse=await page.request.get(base+"/api/_protocolia/bff/session");
  const session=await sessionResponse.json();
  assert.equal(session.authenticated,true);
  assert.match(session.csrf,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(sessionResponse.headers()["cache-control"],"no-store");
  assert.equal(sessionResponse.headers()["x-content-type-options"],"nosniff");
  assert.equal(sessionResponse.headers()["referrer-policy"],"no-referrer");
  assert.match(sessionResponse.headers()["content-security-policy"],/frame-ancestors 'none'/);
  // Real PostgreSQL housekeeping: bounded worker must delete expired records,
  // retain future-dated records and preserve the authenticated browser session.
  const expiredKey=randomBytes(32).toString("hex"),futureKey=randomBytes(32).toString("hex");
  const sql=(q)=>docker([...args,"exec","-T","db","psql",
    "-U","protocolia","-d","protocolia","-Atc",q],15000).trim();
  sql("INSERT INTO protocolia_bff_sessions(sid_hash,payload,expires_at) VALUES "+
    "('"+expiredKey+"','expired-probe',now()-INTERVAL '1 minute'),"+
    "('"+futureKey+"','future-probe',now()+INTERVAL '1 hour')");
  let expiredDeleted=false;
  const cleanupDeadline=Date.now()+20000;
  while(Date.now()<cleanupDeadline){
    const count=Number(sql("SELECT count(*) FROM protocolia_bff_sessions WHERE sid_hash='"+expiredKey+"'"));
    if(count===0){expiredDeleted=true;break;}
    await new Promise(ok=>setTimeout(ok,1000));
  }
  assert.ok(expiredDeleted,"BFF expired rows must be cleaned without external cron");
  assert.equal(Number(sql("SELECT count(*) FROM protocolia_bff_sessions WHERE sid_hash='"+futureKey+"'")),1,
    "BFF housekeeping must not delete valid future-dated sessions");
  assert.equal((await page.request.get(base+"/api/_protocolia/bff/session")).status(),200);
  sql("DELETE FROM protocolia_bff_sessions WHERE sid_hash='"+futureKey+"'");

  const noCsrf=await page.request.post(base+"/api/notes",{
    data:{noteCode:"unauthorized",title:"CSRF attempted"}
  });
  assert.equal(noCsrf.status(),403,"CSRF must block mutations");
  const badOrigin=await page.request.post(base+"/api/notes",{
    headers:{"X-ProtocolIA-CSRF":session.csrf,Origin:"https://attacker.example"},
    data:{noteCode:"wrong-origin",title:"Attempt"}
  });
  assert.equal(badOrigin.status(),403,"Cross-origin write forbidden even with CSRF");
  const foreignFetch=await page.request.post(base+"/api/notes",{
    headers:{"X-ProtocolIA-CSRF":session.csrf,"Sec-Fetch-Site":"cross-site"},
    data:{noteCode:"fetch-site",title:"Cross-site attempt"}
  });
  assert.equal(foreignFetch.status(),403,"Cross-site fetch metadata must be blocked");
  const directBearer=await page.request.get(base+"/api/_protocolia/me",{
    headers:{Authorization:"Bearer "+token()}
  });
  assert.equal(directBearer.status(),401,"Bearer header forbidden in cookie session mode");
  await page.getByTestId("open-create").click();
  const form=page.getByTestId("create-form-PrivateNote");
  const code="bff-"+randomBytes(5).toString("hex");
  await form.getByTestId("create-noteCode").fill(code);
  await form.getByTestId("create-title").fill("Created with HttpOnly session");
  const posting=page.waitForResponse(r=>r.request().method()==="POST"&&
    new URL(r.url()).pathname==="/api/notes");
  await form.getByRole("button",{name:"Crear",exact:true}).click();
  assert.equal((await posting).status(),201,"Generated write must work through BFF CSRF");
  const detail=await page.request.get(base+"/api/notes/"+code);
  assert.equal(detail.status(),200);
  assert.equal((await detail.json()).owner,"alice");
  assert.equal(bearerLeaks.length,0);
  await page.reload({waitUntil:"domcontentloaded"});
  await page.getByTestId("open-create").waitFor({timeout:15000});
  assert.equal(exchanges,1,"BFF cookie must restore session without a new OAuth exchange");
  await page.getByRole("button",{name:"Cerrar sesión"}).click();
  await page.getByTestId("login-provider").waitFor({timeout:15000});
  assert.deepEqual(await (await page.request.get(base+"/api/_protocolia/bff/session")).json(),
    {authenticated:false});
  assert.equal((await page.request.get(base+"/api/notes")).status(),401,
    "Server session must be revoked after logout");
  const forgedResponse=await page.request.get(callback+"?code=forged&state=wrong&iss="+encodeURIComponent(issuer));
  assert.ok([400,401,403].includes(forgedResponse.status()),
    "Forged callback without login state must fail closed");
  assert.equal(exchanges,1,"Forged callback must not reach the provider");
  assert.deepEqual(errors,[]);
  await page.screenshot({path:join(generated,"s1-bff-nest-mobile.png"),fullPage:true});
 }finally{await browser.close();}
 console.log("PROTOCOLIA_S1D2G_NEST_BFF_PASS "+JSON.stringify({
   serverPkce:true,signedIdentity:true,encryptedDbSession:true,httpOnly:true,
   expiredSessionCleanup:true,activeSessionPreserved:true,fetchMetadataEnforced:true,defensiveHeaders:true,
   oauthLoginRestartsAcrossSpringInstances:restartDuringOAuth,
   noBrowserBearer:true,csrf:true,originChecked:true,serverLogout:true,
   reloadRestoresSession:true,forgedCallbackDenied:true
 }));
}finally{
 if(running)try{docker([...args,"down","--volumes","--remove-orphans"],120000)}
 catch(error){console.error(error.message);process.exitCode=1;}
 if(provider)await new Promise(ok=>provider.close(ok));
 rmSync(temp,{recursive:true,force:true});
}
