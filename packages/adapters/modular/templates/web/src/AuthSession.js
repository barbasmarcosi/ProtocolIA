// Shared by every generated React application, regardless of backend adapter.
// React retains bearer tokens in memory; the backend remains the authority for auth.
export const AUTH_REJECTED_EVENT = "protocolia:auth-rejected";
// Opaque BFF session marker, NOT a bearer token. CSRF stays in memory only.
let bffCsrf="";
export function setBffCsrf(value){bffCsrf=typeof value==="string"?value:"";}
export function getBffCsrf(){return bffCsrf;}

export function jwtExpiresAt(authorization) {
  if(typeof authorization!=="string"||!authorization.startsWith("Bearer "))return null;
  const parts=authorization.slice(7).split(".");
  if(parts.length!==3||!/^[A-Za-z0-9_-]+$/.test(parts[1]))return null;
  try{
    const payload=JSON.parse(atob(parts[1].replace(/-/g,"+").replace(/_/g,"/")));
    // This is only a display/session-expiration hint from an untrusted JWT claim.
    // The backend verifies the signature, issuer, audience and grants independently.
    if(!Number.isSafeInteger(payload?.exp)||payload.exp<=0||
       payload.exp>Number.MAX_SAFE_INTEGER/1000)return null;
    return payload.exp*1000;
  }catch{return null;}
}

export async function authenticatedFetch(resource, options) {
  const authorization=options?.headers?.Authorization;
  if(typeof authorization!=="string"||!authorization)
    throw Error("La solicitud requiere una sesión autenticada.");
  const bff=authorization==="BFF";
  const headers={...options.headers};
  if(bff){
    delete headers.Authorization;
    if(!["GET","HEAD","OPTIONS"].includes((options.method??"GET").toUpperCase())){
      if(!/^[A-Za-z0-9_-]{43}$/.test(bffCsrf))throw Error("La sesión no tiene protección CSRF válida.");
      headers["X-ProtocolIA-CSRF"]=bffCsrf;
    }
  }
  const response=await fetch(resource,{...options,headers});
  if(response.status===401&&typeof window!=="undefined"){
    // Tie the rejection to the exact credential that made this request.
    // An old in-flight 401 must never log out a newly authenticated identity.
    window.dispatchEvent(new CustomEvent(AUTH_REJECTED_EVENT,{
      detail:{authorization}
    }));
  }
  return response;
}
