// Nest BFF: bearer kept only in encrypted PostgreSQL sessions; no browser access tokens.
import {createCipheriv,createDecipheriv,createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {createRemoteJWKSet,decodeJwt,jwtVerify} from "jose";
import type {NestExpressApplication} from "@nestjs/platform-express";
import type {Pool} from "pg";
type Identity={username:string;capabilities:string[]};
type Runtime={oidcConfig():Record<string,any>;login(req:any):Promise<Identity>};
type Stored={access:string;csrf:string;expires:number};
const id=()=>randomBytes(32).toString("base64url");
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
function equal(a:string,b:string):boolean{
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}
function cookies(req:any):Record<string,string>{
  const entries:Record<string,string>={};
  for(const part of String(req.headers.cookie??"").split(";")){
    const i=part.indexOf("=");if(i<=0)continue;
    const k=part.slice(0,i).trim(),v=part.slice(i+1).trim();
    if(k&&!(k in entries)&&v.length<10000)entries[k]=v;
  }
  return entries;
}
function boundedJwt(value:unknown):value is string{
  return typeof value==="string"&&value.length<=16384&&
    value.split(".").length===3&&/^[A-Za-z0-9._-]+$/.test(value);
}
async function readJson(url:string,init:RequestInit,limit=32768):Promise<any>{
  const res=await fetch(url,{...init,redirect:"error",signal:AbortSignal.timeout(5000)});
  if(!res.ok||!res.headers.get("content-type")?.toLowerCase().includes("application/json"))
    throw Error("OIDC JSON endpoint refused");
  const declared=Number(res.headers.get("content-length"));
  if(Number.isFinite(declared)&&declared>limit)throw Error("OIDC response too large");
  const reader=res.body?.getReader();if(!reader)throw Error("OIDC response missing");
  const chunks:Uint8Array[]=[];let n=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;
      n+=value.length;if(n>limit)throw Error("OIDC response too large");chunks.push(value);
    }
  }finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(n);let offset=0;
  for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}
// Restrict scripts and network requests while permitting React's generated
// inline style attributes. This is stricter than the previous API-only CSP.
export function installBffSecurityHeaders(app:NestExpressApplication):void{
  if(process.env.PROTOCOLIA_BFF_ENABLED!=="true")return;
  // Security follows the registered browser origin; mock IdP may use test HTTP.
  const https=(process.env.PROTOCOLIA_OIDC_BFF_REDIRECT_URI??"").startsWith("https://");
  const csp=[
    "default-src 'self'","script-src 'self'","script-src-attr 'none'",
    "style-src 'self'","style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'","img-src 'self' data:",
    "font-src 'self' data:","connect-src 'self'","manifest-src 'self'",
    "form-action 'self'","base-uri 'none'","object-src 'none'",
    "frame-ancestors 'none'",...(https?["upgrade-insecure-requests"]:[ ])
  ].join("; ");
  app.use((_req:any,res:any,next:any)=>{
    res.setHeader("Content-Security-Policy",csp);
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Referrer-Policy","no-referrer");
    res.setHeader("X-Frame-Options","DENY");
    if(https)res.setHeader("Strict-Transport-Security","max-age=31536000");
    next();
  });
}
export async function installBff(app:NestExpressApplication,pool:Pool,runtime:Runtime):Promise<boolean>{
  const enabled=process.env.PROTOCOLIA_BFF_ENABLED??"false";
  if(!["true","false"].includes(enabled))throw Error("Invalid BFF policy");
  if(enabled==="false")return false;
  const cleanupMs=Number(process.env.PROTOCOLIA_BFF_CLEANUP_INTERVAL_MS??"300000");
  if(!Number.isSafeInteger(cleanupMs)||cleanupMs<1000||cleanupMs>3600000)
    throw Error("Invalid BFF cleanup interval (1000..3600000)");
  const config=runtime.oidcConfig();
  if(process.env.PROTOCOLIA_AUTH_MODE!=="jwt"||
     process.env.PROTOCOLIA_OIDC_DISCOVERY_REQUIRED!=="true"||
     process.env.PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED!=="true"||
     !config.enabled||!config.requireIssuerResponse||!config.requireIdToken)
    throw Error("BFF requires verified JWT, OIDC discovery and signed identity proof");
  const rawKey=process.env.PROTOCOLIA_BFF_ENCRYPTION_KEY??"";
  if(!/^[a-fA-F0-9]{64}$/.test(rawKey))throw Error("BFF requires 32-byte encryption key (64 hex chars)");
  const key=Buffer.from(rawKey,"hex"),http=process.env.PROTOCOLIA_JWT_ALLOW_TEST_HTTP==="true";
  const callback=process.env.PROTOCOLIA_OIDC_BFF_REDIRECT_URI??"";
  let callbackUri:URL;
  try{callbackUri=new URL(callback);}catch{throw Error("Invalid BFF redirect URI");}
  if((callbackUri.protocol!=="https:"&&!(http&&callbackUri.protocol==="http:"))||
      callbackUri.username||callbackUri.password||callbackUri.search||callbackUri.hash||
      callbackUri.pathname!=="/api/_protocolia/bff/callback")
    throw Error("Invalid registered BFF redirect URI");
  const origin=callbackUri.origin;
  const authorizationEndpoint=config.authorizationEndpoint as string,
    tokenEndpoint=config.tokenEndpoint as string,issuer=config.issuer as string,
    client=config.clientId as string;
  const jwks=process.env.PROTOCOLIA_JWT_JWKS_URI!;
  const trusted=createRemoteJWKSet(new URL(jwks),{timeoutDuration:5000,cacheMaxAge:60000});
  const secureBrowser=callbackUri.protocol==="https:";
  const sidCookie=secureBrowser?"__Host-pia_bff":"pia_bff_dev";
  const txnCookie=secureBrowser?"__Host-pia_login":"pia_login_dev";
  const flags=(max:number)=>"Path=/; HttpOnly; SameSite=Lax; "+
    (secureBrowser?"Secure; ":"")+"Max-Age="+max;
  const writeCookie=(res:any,name:string,value:string,max:number)=>
    res.append("Set-Cookie",name+"="+value+"; "+flags(max));
  const seal=(value:unknown):string=>{
    const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString("base64url");
  };
  const open=(encoded:string):any=>{
    const data=Buffer.from(encoded,"base64url");
    if(data.length<29||data.length>18000)throw Error("Bad encrypted session");
    const decipher=createDecipheriv("aes-256-gcm",key,data.subarray(0,12));
    decipher.setAuthTag(data.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString("utf8"));
  };
  await pool.query("CREATE TABLE IF NOT EXISTS protocolia_bff_sessions ("+
    "sid_hash CHAR(64) PRIMARY KEY,payload TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL)");
  await pool.query("CREATE INDEX IF NOT EXISTS protocolia_bff_expiration_idx "+
    "ON protocolia_bff_sessions(expires_at)");
  // Bounded SKIP LOCKED batches allow multiple replicas to clean safely.
  const cleanup=async():Promise<void>=>{
    try{
      const result=await pool.query(`WITH expired AS (
        SELECT sid_hash FROM protocolia_bff_sessions
        WHERE expires_at<now() ORDER BY expires_at
        LIMIT 200 FOR UPDATE SKIP LOCKED
      )
      DELETE FROM protocolia_bff_sessions AS s USING expired
      WHERE s.sid_hash=expired.sid_hash`);
      if(result.rowCount)console.info("PROTOCOLIA_BFF_CLEANUP deleted="+result.rowCount);
    }catch(error){console.error("PROTOCOLIA_BFF_CLEANUP_FAILED",error);}
  };
  void cleanup();
  setInterval(()=>{void cleanup();},cleanupMs).unref();
  const router=app.getHttpAdapter().getInstance();
  const load=async(req:any):Promise<{sid:string;data:Stored;user:Identity}|null>=>{
    const sid=cookies(req)[sidCookie];
    if(typeof sid!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(sid))return null;
    const result=await pool.query("SELECT payload FROM protocolia_bff_sessions WHERE sid_hash=$1 AND expires_at>now()",[digest(sid)]);
    if(result.rowCount!==1)return null;
    try{
      const data=open(result.rows[0].payload) as Stored;
      if(!data||!boundedJwt(data.access)||!Number.isFinite(data.expires)||
         data.expires<=Date.now()||!(/^[A-Za-z0-9_-]{43}$/.test(data.csrf)))return null;
      const user=await runtime.login({headers:{authorization:"Bearer "+data.access}});
      return {sid,data,user};
    }catch{return null;}
  };
  const noStore=(res:any)=>res.set("Cache-Control","no-store");
  const fail=(res:any,status:number)=>res.status(status).json({statusCode:status,message:"Session rejected"});
  const foreignFetch=(req:any)=>req.headers["sec-fetch-site"]==="cross-site";
  const failLogin=(res:any)=>{
    writeCookie(res,txnCookie,"",0);
    res.status(400).type("text/plain").send("OIDC authentication could not be completed");
  };
  const verifyIdentity=async(idToken:string,access:string,nonce:string,user:Identity)=>{
    const {payload,protectedHeader}=await jwtVerify(idToken,trusted,{
      issuer,audience:client,algorithms:["RS256"],requiredClaims:["exp","iat","sub"]});
    const audiences=typeof payload.aud==="string"?[payload.aud]:payload.aud;
    if(protectedHeader.alg!=="RS256"||!Array.isArray(audiences)||
       audiences.length!==1||audiences[0]!==client||
       (payload.azp!==undefined&&payload.azp!==client)||
       payload.nonce!==nonce||payload.sub!==user.username||
       typeof payload.iat!=="number"||
       payload.iat<Math.floor(Date.now()/1000)-600||
       payload.iat>Math.floor(Date.now()/1000)+60)
      throw Error("OIDC ID token claims rejected");
    if(payload.at_hash!==undefined){
      const expected=createHash("sha256").update(access).digest().subarray(0,16).toString("base64url");
      if(payload.at_hash!==expected)throw Error("OIDC at_hash rejected");
    }
    return payload;
  };
  router.get("/api/_protocolia/bff/login",(_req:any,res:any)=>{
    noStore(res);
    const nonce=id(),state=id(),verifier=id(),challenge=createHash("sha256").update(verifier).digest("base64url");
    writeCookie(res,txnCookie,seal({state,nonce,verifier,at:Date.now()}),300);
    const url=new URL(authorizationEndpoint);
    for(const [k,v] of Object.entries({response_type:"code",client_id:client,
      redirect_uri:callback,scope:config.scope,state,nonce,
      code_challenge:challenge,code_challenge_method:"S256"}))url.searchParams.set(k,String(v));
    res.redirect(302,url.toString());
  });
  router.get("/api/_protocolia/bff/callback",async(req:any,res:any)=>{
    noStore(res);
    const incoming=new URL(req.originalUrl,origin);
    const get=(name:string)=>{
      const all=incoming.searchParams.getAll(name);return all.length===1?all[0]:null;
    };
    const raw=cookies(req)[txnCookie];
    let txn:any;try{if(!raw)throw Error("Missing state");txn=open(raw);}catch{return failLogin(res);}
    writeCookie(res,txnCookie,"",0);
    if(typeof txn?.state!=="string"||!get("state")||!equal(txn.state,get("state")!)||
       !/^[A-Za-z0-9_-]{43}$/.test(txn.nonce??"")||
       !/^[A-Za-z0-9_-]{43}$/.test(txn.verifier??"")||
       !Number.isFinite(txn.at)||Date.now()-txn.at>300000||txn.at>Date.now()+30000||
       get("iss")!==issuer||!get("code")||get("code")!.length>1024||
       incoming.searchParams.has("error"))return failLogin(res);
    try{
      const token=await readJson(tokenEndpoint,{method:"POST",cache:"no-store",
        headers:{"Content-Type":"application/x-www-form-urlencoded"},
        body:new URLSearchParams({grant_type:"authorization_code",client_id:client,
          code:get("code")!,redirect_uri:callback,code_verifier:txn.verifier})});
      if(!token||token.token_type?.toLowerCase()!=="bearer"||
         !boundedJwt(token.access_token)||!boundedJwt(token.id_token))
        throw Error("Invalid OIDC tokens");
      const user=await runtime.login({headers:{authorization:"Bearer "+token.access_token}});
      const identity=await verifyIdentity(token.id_token,token.access_token,txn.nonce,user);
      const accessClaims=decodeJwt(token.access_token);
      const expiration=Math.min(Number(accessClaims.exp)*1000,Number(identity.exp)*1000,Date.now()+1200000);
      if(!Number.isFinite(expiration)||expiration<=Date.now())throw Error("Expired identity");
      const sid=id(),csrf=id();
      await pool.query("INSERT INTO protocolia_bff_sessions(sid_hash,payload,expires_at) VALUES($1,$2,$3)",
        [digest(sid),seal({access:token.access_token,csrf,expires:expiration}),new Date(expiration)]);
      writeCookie(res,sidCookie,sid,Math.max(1,Math.floor((expiration-Date.now())/1000)));
      res.redirect(303,"/");
    }catch{return failLogin(res);}
  });
  router.get("/api/_protocolia/bff/session",async(req:any,res:any)=>{
    noStore(res);
    const current=await load(req);
    res.status(200).json(current?{authenticated:true,username:current.user.username,
      capabilities:current.user.capabilities,csrf:current.data.csrf}:{authenticated:false});
  });
  router.post("/api/_protocolia/bff/logout",async(req:any,res:any)=>{
    noStore(res);
    const current=await load(req);
    if(!current)return fail(res,401);
    if(typeof req.headers["x-protocolia-csrf"]!=="string"||
       !equal(req.headers["x-protocolia-csrf"],current.data.csrf)||
       (req.headers.origin!==undefined&&req.headers.origin!==origin)||foreignFetch(req))return fail(res,403);
    await pool.query("DELETE FROM protocolia_bff_sessions WHERE sid_hash=$1",[digest(current.sid)]);
    writeCookie(res,sidCookie,"",0);
    res.status(204).end();
  });
  router.use("/api",async(req:any,res:any,next:any)=>{
    if(req.path==="/_protocolia/auth/config")return next();
    noStore(res);
    // Disallow client-supplied Authorization even when cookie is valid.
    if(req.headers.authorization!==undefined)return fail(res,401);
    try{
      const current=await load(req);if(!current)return fail(res,401);
      if(!["GET","HEAD","OPTIONS"].includes(req.method)){
        if(typeof req.headers["x-protocolia-csrf"]!=="string"||
           !equal(req.headers["x-protocolia-csrf"],current.data.csrf)||
           (req.headers.origin!==undefined&&req.headers.origin!==origin)||foreignFetch(req))return fail(res,403);
      }
      req.headers.authorization="Bearer "+current.data.access;
      req.protocoliaBffAuthenticated=true;
      next();
    }catch{fail(res,401);}
  });
  return true;
}
