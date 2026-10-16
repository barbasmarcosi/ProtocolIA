import test from "node:test";
import assert from "node:assert/strict";
import {authenticatedFetch,setBffCsrf,getBffCsrf} from
  "../../packages/adapters/modular/templates/web/src/AuthSession.js";
const csrf="a".repeat(43);
test("BFF fetch never sends a bearer marker; writes require memory-only CSRF",async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return {status:200,ok:true};};
 try{
   setBffCsrf("");
   await assert.rejects(()=>authenticatedFetch("/api/test",{
     method:"POST",headers:{Authorization:"BFF"},body:"{}"}),/CSRF/);
   assert.equal(calls.length,0);
   setBffCsrf(csrf);
   assert.equal(getBffCsrf(),csrf);
   await authenticatedFetch("/api/notes",{method:"POST",
     headers:{Authorization:"BFF","Content-Type":"application/json"},body:"{}"});
   await authenticatedFetch("/api/notes",{headers:{Authorization:"BFF"}});
   assert.equal(calls[0].opts.headers.Authorization,undefined);
   assert.equal(calls[0].opts.headers["X-ProtocolIA-CSRF"],csrf);
   assert.equal(calls[1].opts.headers.Authorization,undefined);
   assert.equal(calls[1].opts.headers["X-ProtocolIA-CSRF"],undefined);
   await authenticatedFetch("/api/notes",{headers:{Authorization:"Bearer signed.token.value"}});
   assert.equal(calls[2].opts.headers.Authorization,"Bearer signed.token.value");
   assert.equal(calls[2].opts.headers["X-ProtocolIA-CSRF"],undefined);
 }finally{setBffCsrf("");globalThis.fetch=original;}
});
