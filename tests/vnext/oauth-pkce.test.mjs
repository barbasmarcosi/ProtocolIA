import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {beginPkce,finishPkce,hasPkceResponse} from "../../packages/adapters/modular/templates/web/src/OAuthPkce.js";
const config={mode:"jwt",enabled:true,issuer:"https://issuer.test",
 authorizationEndpoint:"https://issuer.test/authorize",tokenEndpoint:"https://issuer.test/token",
 clientId:"protocolia-spa",redirectUri:"https://app.test/",scope:"openid profile"};
const store=new Map();
globalThis.btoa=s=>Buffer.from(s,"binary").toString("base64");
globalThis.sessionStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
const loc={origin:"https://app.test",protocol:"https:",hostname:"app.test",pathname:"/",search:"",href:"https://app.test/",assign(url){this.next=url;}};
globalThis.location=loc;
globalThis.history={state:null,replaceState(_state,_title,url){this.cleaned=url;}};
function callback(query){loc.search=query;loc.href="https://app.test/"+query;}
test("Authorization Code starts with unpredictable PKCE-S256 and registered redirect",async()=>{
 store.clear();callback("");assert.equal(hasPkceResponse(),false);
 await beginPkce(config);
 const url=new URL(loc.next);
 assert.equal(url.origin,"https://issuer.test");
 assert.equal(url.searchParams.get("response_type"),"code");
 assert.equal(url.searchParams.get("code_challenge_method"),"S256");
 assert.equal(url.searchParams.get("redirect_uri"),config.redirectUri);
 const txn=JSON.parse([...store.values()][0]);
 assert.equal(txn.state,url.searchParams.get("state"));
 assert.equal(url.searchParams.get("code_challenge"),createHash("sha256").update(txn.verifier).digest("base64url"));
});
test("Callback exchanges code using original verifier once, removes URL values and never persists access token",async()=>{
 const txn=JSON.parse([...store.values()][0]);
 callback("?code=test-code&state="+txn.state+"&iss="+encodeURIComponent(config.issuer));
 assert.equal(hasPkceResponse(),true);
 const requests=[];
 globalThis.fetch=async(_url,options)=>{
  requests.push(options);
  return {ok:true,async json(){return {token_type:"Bearer",access_token:"signed.token.payload"};}};
 };
 const auth=await finishPkce(config);
 assert.equal(auth,"Bearer signed.token.payload");
 assert.equal(requests.length,1);
 const request=new URLSearchParams(requests[0].body);
 assert.equal(request.get("code_verifier"),txn.verifier);
 assert.equal(request.get("redirect_uri"),config.redirectUri);
 assert.equal(history.cleaned,"/");
 assert.equal(store.size,0);
 await assert.rejects(()=>finishPkce(config),/expiró|utilizada/);
});
test("Forged state or wrong issuer is rejected before token exchange",async()=>{
 for(const uri of ["?code=test&state=forged","?code=test&state=real&iss=https%3A%2F%2Fevil.test"]){
  callback("");await beginPkce(config);
  const txn=JSON.parse([...store.values()][0]);
  callback(uri.replace("state=real","state="+txn.state));
  await assert.rejects(()=>finishPkce(config),/no válida/);
  assert.equal(store.size,0);
 }
});
test("Cross-origin redirect configuration is refused",async()=>{
 callback("");
 await assert.rejects(()=>beginPkce({...config,redirectUri:"https://attacker.test/"}),/no corresponde/);
});

test("Strict discovery binding requires a single matching RFC 9207 issuer before token exchange",async()=>{
 for(const uri of [
   "?code=test&state=actual",
   "?code=test&state=actual&iss=https%3A%2F%2Fevil.test",
   "?code=test&state=actual&iss="+encodeURIComponent(config.issuer)+"&iss="+encodeURIComponent(config.issuer)
 ]){
   callback("");await beginPkce(config);
   const transaction=JSON.parse([...store.values()][0]);
   callback(uri.replace("state=actual","state="+transaction.state));
   let exchanges=0;
   globalThis.fetch=async()=>{exchanges++;throw Error("Must reject callback before exchange");};
   await assert.rejects(()=>finishPkce({...config,requireIssuerResponse:true}),/no válida/);
   assert.equal(exchanges,0);
   assert.equal(store.size,0);
   assert.equal(history.cleaned,"/");
 }
 callback("");await beginPkce(config);
 const transaction=JSON.parse([...store.values()][0]);
 callback("?code=good&state="+transaction.state+"&iss="+encodeURIComponent(config.issuer));
 let requests=0;
 globalThis.fetch=async()=>{requests++;return {
   ok:true,async json(){return {token_type:"Bearer",access_token:"signed.token.payload"};}
 };};
 assert.equal(await finishPkce({...config,requireIssuerResponse:true}),"Bearer signed.token.payload");
 assert.equal(requests,1);
});

test("OIDC client emits an unpredictable per-login nonce and passes ID Token only for server-side verification",async()=>{
 callback("");store.clear();
 const enabled={...config,requireIssuerResponse:true,requireIdToken:true};
 await beginPkce(enabled);
 const url=new URL(loc.next),txn=JSON.parse([...store.values()][0]);
 assert.equal(url.searchParams.get("nonce"),txn.nonce);
 assert.match(txn.nonce,/^[A-Za-z0-9_-]{43,}$/);
 assert.notEqual(txn.nonce,txn.state);
 callback("?code=valid&state="+txn.state+"&iss="+encodeURIComponent(config.issuer));
 globalThis.fetch=async()=>({ok:true,async json(){
   return {token_type:"Bearer",access_token:"signed.token.payload",id_token:"signed.identity.payload"};
 }});
 const result=await finishPkce(enabled);
 assert.deepEqual(result,{authorization:"Bearer signed.token.payload",
   proof:{idToken:"signed.identity.payload",nonce:txn.nonce}});
 assert.equal(store.size,0);
 assert.equal(history.cleaned,"/");
 callback("");await beginPkce(enabled);
 const next=JSON.parse([...store.values()][0]);
 assert.notEqual(txn.nonce,next.nonce);
 callback("?code=valid2&state="+next.state+"&iss="+encodeURIComponent(config.issuer));
 globalThis.fetch=async()=>({ok:true,async json(){
   return {token_type:"Bearer",access_token:"signed.token.payload"};
 }});
 await assert.rejects(()=>finishPkce(enabled),/identidad OIDC/);
 assert.equal(store.size,0);
});
