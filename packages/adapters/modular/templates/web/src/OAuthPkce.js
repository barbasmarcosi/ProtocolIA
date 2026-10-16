// Generated-app OAuth 2.0 Authorization Code + PKCE (public browser client).
// A token is kept in React memory only; sessionStorage holds one short-lived PKCE transaction.
const key="protocolia.oauth2.pkce.transaction.v1";
function randomUrlSafe(size=32){
  if(!globalThis.crypto?.getRandomValues)throw Error("Se necesita una conexión segura para iniciar sesión.");
  const bytes=crypto.getRandomValues(new Uint8Array(size));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function checkedConfig(config){
  if(!config||config.mode!=="jwt"||config.enabled!==true)throw Error("OAuth2 no está configurado.");
  const u=new URL(config.redirectUri);
  if(u.origin!==location.origin||u.search||u.hash||u.pathname!=="/")
    throw Error("La dirección de retorno no corresponde a esta aplicación.");
  if(!["https:",...(location.hostname==="localhost"||location.hostname==="127.0.0.1"?["http:"]:[])].includes(location.protocol))
    throw Error("La aplicación debe utilizar HTTPS.");
  for(const field of ["authorizationEndpoint","tokenEndpoint"]){
    const target=new URL(config[field]);
    if(target.protocol!=="https:"&&target.protocol!=="http:")throw Error("Proveedor OAuth2 inválido.");
  }
  return u;
}
export function hasPkceResponse(){
  const query=new URLSearchParams(location.search);
  return query.has("code")||query.has("error");
}
export async function beginPkce(config){
  checkedConfig(config);
  const state=randomUrlSafe(),verifier=randomUrlSafe(),created=Date.now();
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
  sessionStorage.setItem(key,JSON.stringify({
    state,verifier,created,clientId:config.clientId,issuer:config.issuer,
    redirectUri:config.redirectUri
  }));
  const url=new URL(config.authorizationEndpoint);
  url.searchParams.set("response_type","code");
  url.searchParams.set("client_id",config.clientId);
  url.searchParams.set("redirect_uri",config.redirectUri);
  url.searchParams.set("scope",config.scope);
  url.searchParams.set("state",state);
  url.searchParams.set("code_challenge",challenge);
  url.searchParams.set("code_challenge_method","S256");
  location.assign(url.toString());
}
export async function finishPkce(config){
  checkedConfig(config);
  if(!hasPkceResponse())return null;
  const callback=new URL(location.href),query=callback.searchParams;
  const code=query.getAll("code"),state=query.getAll("state"),error=query.getAll("error"),issuers=query.getAll("iss");
  // Remove OAuth response parameters immediately, before any network call.
  for(const name of ["code","state","error","error_description","iss","session_state"])
    callback.searchParams.delete(name);
  history.replaceState(history.state,"",callback.pathname+callback.search+callback.hash);
  const serialized=sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if(!serialized)throw Error("La solicitud de inicio de sesión expiró o ya fue utilizada.");
  let transaction;
  try{transaction=JSON.parse(serialized);}catch{throw Error("Estado de autenticación inválido.");}
  if(location.origin+location.pathname!==config.redirectUri||
    transaction.redirectUri!==config.redirectUri||
    transaction.clientId!==config.clientId||transaction.issuer!==config.issuer||
    !Number.isFinite(transaction.created)||Date.now()-transaction.created>300000||
    transaction.created>Date.now()+30000||
    !/^[A-Za-z0-9_-]{43,}$/.test(transaction.verifier??"")||
    !/^[A-Za-z0-9_-]{43,}$/.test(transaction.state??"")||
    state.length!==1||transaction.state!==state[0]||issuers.length>1||
    (config.requireIssuerResponse===true&&issuers.length!==1)||
    (issuers.length===1&&issuers[0]!==config.issuer))
    throw Error("Respuesta de autenticación no válida.");
  if(error.length)throw Error("El proveedor de identidad rechazó el inicio de sesión.");
  if(code.length!==1||!code[0]||code[0].length>1024)
    throw Error("Falta el código de autorización.");
  const response=await fetch(config.tokenEndpoint,{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"authorization_code",client_id:config.clientId,
      code:code[0],redirect_uri:config.redirectUri,code_verifier:transaction.verifier}),
    cache:"no-store"
  });
  if(!response.ok)throw Error("El proveedor no pudo completar el intercambio OAuth2.");
  const data=await response.json();
  if(data.token_type?.toLowerCase()!=="bearer"||typeof data.access_token!=="string"||
    data.access_token.length>16384||data.access_token.split(".").length!==3)
    throw Error("El proveedor no entregó un token de acceso JWT válido.");
  // The generated backend, not this UI, verifies the signed token and grants.
  return "Bearer "+data.access_token;
}
