import test from "node:test";
import assert from "node:assert/strict";
import {authenticatedFetch,AUTH_REJECTED_EVENT,jwtExpiresAt} from
  "../../packages/adapters/modular/templates/web/src/AuthSession.js";

function jwt(payload){
  const b64=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  return "Bearer "+b64({alg:"RS256"})+"."+b64(payload)+".signed";
}

test("JWT exp is used only as bounded UX hint; demo Basic and malformed tokens have no hint",()=>{
  assert.equal(jwtExpiresAt(jwt({exp:1700000000})),1700000000000);
  for(const credential of [
    "",null,"Basic ZGVtbzpwYXNz","Bearer garbage","Bearer header.!invalid.signature",
    jwt({exp:"1700000000"}),jwt({exp:1.5}),jwt({exp:-1}),
    jwt({exp:Number.MAX_SAFE_INTEGER})
  ])assert.equal(jwtExpiresAt(credential),null);
});

test("Authenticated fetch propagates the exact rejected credential, never a stale/global identity",async()=>{
  const oldWindow=globalThis.window,oldFetch=globalThis.fetch;
  const oldCustomEvent=globalThis.CustomEvent;
  const target=new EventTarget(),received=[];
  globalThis.window=target;
  globalThis.CustomEvent=class extends Event{
    constructor(type,options){super(type);this.detail=options.detail;}
  };
  target.addEventListener(AUTH_REJECTED_EVENT,event=>received.push(event.detail));
  try{
    const calls=[];
    globalThis.fetch=async(url,options)=>{
      calls.push({url,authorization:options.headers.Authorization});
      return {status:401,ok:false};
    };
    await authenticatedFetch("/api/notes",{headers:{Authorization:"Bearer old"}});
    assert.deepEqual(calls,[{url:"/api/notes",authorization:"Bearer old"}]);
    assert.deepEqual(received,[{authorization:"Bearer old"}]);
    globalThis.fetch=async()=>({status:403,ok:false});
    await authenticatedFetch("/api/notes",{headers:{Authorization:"Bearer new"}});
    assert.equal(received.length,1,"403 is authorization, not an expired session");
    globalThis.fetch=async()=>({status:200,ok:true});
    await authenticatedFetch("/api/notes",{headers:{Authorization:"Bearer new"}});
    assert.equal(received.length,1);
    await assert.rejects(()=>authenticatedFetch("/api/notes",{headers:{}}),/autenticada/);
    assert.equal(received.length,1);
  }finally{
    globalThis.window=oldWindow;globalThis.fetch=oldFetch;
    globalThis.CustomEvent=oldCustomEvent;
  }
});

test("Network errors do not masquerade as rejected credentials",async()=>{
  const oldWindow=globalThis.window,oldFetch=globalThis.fetch;
  const target=new EventTarget(),events=[];
  globalThis.window=target;
  target.addEventListener(AUTH_REJECTED_EVENT,event=>events.push(event));
  globalThis.fetch=async()=>{throw new TypeError("network offline");};
  try{
    await assert.rejects(()=>authenticatedFetch("/api/notes",{headers:{Authorization:"Bearer identity"}}),/offline/);
    assert.equal(events.length,0);
  }finally{globalThis.window=oldWindow;globalThis.fetch=oldFetch;}
});
