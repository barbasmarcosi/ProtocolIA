#!/usr/bin/env node
// Disposable HTTP+PostgreSQL oracle. Sandbox HMAC, no external provider or settlement.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHmac,randomBytes} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:net";

const root=resolve(process.argv[2]??"");
const build=JSON.parse(readFileSync(join(root,"protocolia-build.json"),"utf8"));
assert.ok(["nestjs","modular-spring"].includes(build.target));
const scratch=mkdtempSync(join(tmpdir(),"pia-provider-http-"));
const project="pia_http_"+randomBytes(5).toString("hex");
const key=randomBytes(32);
const env={
  PROTOCOLIA_DB_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_MANAGER_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_READER_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_ALLOW_DEMO_AUTH:"true",
  PROTOCOLIA_PROVIDER_SANDBOX_ENABLED:"true",
  PROTOCOLIA_PROVIDER_SANDBOX_KEY_HEX:key.toString("hex")
};
const compose=["compose","--project-name",project,"--env-file",join(scratch,"env")];
const docker=(args,allowFail=false)=>{
  const r=spawnSync("docker",[...compose,...args],{cwd:root,env:{...process.env,...env},
    encoding:"utf8",timeout:600000,maxBuffer:3*1024*1024});
  if(!allowFail&&(r.error||r.status!==0))
    throw Error("Compose "+args.join(" ")+": "+String(r.stderr||r.error?.message).slice(-2200));
  return r;
};
const sql=query=>docker(["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
  "-U","protocolia","-d","protocolia","-Atc",query]).stdout.trim();
const port=await new Promise((resolve,reject)=>{
  const server=createServer();server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
    const selected=server.address()?.port;
    server.close(error=>error?reject(error):resolve(selected));
  });
});
env.PROTOCOLIA_HOST_PORT=String(port);
writeFileSync(join(scratch,"env"),Object.entries(env).map(([k,v])=>k+"="+v).join("\n")+"\n");
const base="http://127.0.0.1:"+port;
const path="/api/_protocolia/provider/sandbox/inbox";
const body=Buffer.from('{"sandbox":"test","amount":"1.00"}');
function signed(event,raw=body,timestamp=String(Math.floor(Date.now()/1000))){
  const keyId="sandbox_1";
  const mac=createHmac("sha256",key)
    .update("protocolia-provider-proof-v1\n"+keyId+"\n"+timestamp+"\n"+event+"\n")
    .update(raw).digest("hex");
  return {"Content-Type":"application/json","X-ProtocolIA-Key-Id":keyId,
    "X-ProtocolIA-Timestamp":timestamp,"X-ProtocolIA-Event-Id":event,
    "X-ProtocolIA-Signature":"v1="+mac};
}
async function send(event,raw=body,headers=signed(event,raw),endpoint=path){
  const r=await fetch(base+endpoint,{method:"POST",headers,body:raw,
    signal:AbortSignal.timeout(20000)});
  return {status:r.status,body:await r.text()};
}
async function ready(){
  for(let i=0;i<120;i++){
    try{const r=await fetch(base+"/health",{signal:AbortSignal.timeout(2000)});
      if(r.status===200)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error("Generated target did not become healthy");
}
let started=false;
try{
  docker(["up","-d","--build","--wait"],false);started=true;
  await ready();
  const event="evt_http_12345678";
  const responses=await Promise.all(Array.from({length:10},()=>send(event)));
  assert.equal(responses.filter(x=>x.status===202).length,1,JSON.stringify(responses));
  assert.equal(responses.filter(x=>x.status===200).length,9,JSON.stringify(responses));
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox"),"1");
  const changed=Buffer.from('{"sandbox":"test","amount":"2.00"}');
  assert.equal((await send(event,changed,signed(event,changed))).status,409);
  assert.equal((await send(event,changed,signed(event,body))).status,401);
  assert.equal((await send("evt_expired_12345678",body,
    signed("evt_expired_12345678",body,String(Math.floor(Date.now()/1000)-400)))).status,401);
  assert.equal((await send("short")).status,401);
  assert.equal((await send("evt_new_12345678",body,{
    "Content-Type":"application/json"})).status,400);
  const noAuth=await send("evt_valid_12345678");
  assert.equal(noAuth.status,202,"Valid HMAC must work without human Basic auth");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox"),"2");
  assert.equal(sql("SELECT COUNT(*) FROM payment"),"0");

  // S2c-1c3b: synthetic receipt matching over signed sandbox HTTP, never settlement.
  sql("INSERT INTO customer(customer_code,name,contact_note) VALUES "+
    "('C-HTTP-LINK','Synthetic Customer','Sandbox proof only');");
  sql("INSERT INTO vehicle(plate,customer_code,model_name,mileage_km) VALUES "+
    "('CAR-HTTP-LINK','C-HTTP-LINK','Synthetic vehicle',0);");
  sql("INSERT INTO work_order(number,vehicle_plate,symptom,charge_total,opening_balance,available,status) "+
    "VALUES ('OT-HTTP-LINK','CAR-HTTP-LINK','Synthetic order',1.25,1.25,0,'opened');");
  sql("INSERT INTO payment(receipt,order_number,amount,method,destination_account,status,provider_settlement_state) "+
    "VALUES ('PAY-HTTP-LINK','OT-HTTP-LINK',1.25,'card','Synthetic account','posted','unverified');");
  const linkedPath="/api/_protocolia/provider/sandbox/receipt-candidate";
  const claim=(receipt="PAY-HTTP-LINK",order="OT-HTTP-LINK",amount="1.25")=>
    Buffer.from(JSON.stringify({version:"receipt-candidate.v1",
      receiptId:receipt,orderId:order,amount}));
  const linked=(event,raw=claim(),headers=signed(event,raw))=>
    send(event,raw,headers,linkedPath);
  const eventLinked="evt_http_link_12345678";
  const linkedResponses=await Promise.all(Array.from({length:10},()=>linked(eventLinked)));
  assert.equal(linkedResponses.filter(x=>x.status===202).length,1,JSON.stringify(linkedResponses));
  assert.equal(linkedResponses.filter(x=>x.status===200).length,9,JSON.stringify(linkedResponses));
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate"),"1");
  assert.equal(sql("SELECT receipt_id||'/'||order_id||'/'||amount::text "+
    "FROM protocolia_provider_receipt_candidate WHERE event_id='evt_http_link_12345678'"),
    "PAY-HTTP-LINK/OT-HTTP-LINK/1.25");
  const before=sql("SELECT charge_total::text||'/'||available::text "+
    "FROM work_order WHERE number='OT-HTTP-LINK'");
  assert.equal((await linked("evt_http_missing_1234",claim("MISSING-RECEIPT"))).status,404);
  assert.equal((await linked("evt_http_wrongorder",claim("PAY-HTTP-LINK","WRONG-ORDER"))).status,409);
  assert.equal((await linked("evt_http_wrongamt_1",claim("PAY-HTTP-LINK","OT-HTTP-LINK","1.26"))).status,409);
  assert.equal((await linked(eventLinked,claim("PAY-HTTP-LINK","OT-HTTP-LINK","1.26"))).status,409);
  // A second authenticated event ID is not a second independent receipt proof.
  const secondClaimEvent="evt_http_second_claim_123";
  assert.equal((await linked(secondClaimEvent)).status,409);
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id='evt_http_second_claim_123'"),"0");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate "+
    "WHERE receipt_id='PAY-HTTP-LINK'"),"1");

  assert.equal((await linked("evt_http_badver_12",Buffer.from(JSON.stringify({
    version:"receipt-candidate.v2",receiptId:"PAY-HTTP-LINK",orderId:"OT-HTTP-LINK",amount:"1.25"
  })))).status,400);
  assert.equal((await linked("evt_http_badnum_12",Buffer.from(
    '{"version":"receipt-candidate.v1","receiptId":"PAY-HTTP-LINK","orderId":"OT-HTTP-LINK","amount":1.25}'))).status,400);
  assert.equal((await linked("evt_http_badzero12",claim("PAY-HTTP-LINK","OT-HTTP-LINK","0.00"))).status,400);
  assert.equal((await linked("evt_http_badprec12",claim("PAY-HTTP-LINK","OT-HTTP-LINK","1.251"))).status,400);
  assert.equal((await linked("evt_http_badkeys12",Buffer.from(
    '{"version":"receipt-candidate.v1","receiptId":"PAY-HTTP-LINK","receiptId":"PAY-HTTP-LINK","orderId":"OT-HTTP-LINK","amount":"1.25"}'))).status,400);
  assert.equal((await linked("evt_http_extra_123",Buffer.from(
    '{"version":"receipt-candidate.v1","receiptId":"PAY-HTTP-LINK","orderId":"OT-HTTP-LINK","amount":"1.25","settled":true}'))).status,400);
  const tampered=claim("PAY-HTTP-LINK","OT-HTTP-LINK","1.26");
  assert.equal((await linked("evt_http_tamper_12",tampered,
    signed("evt_http_tamper_12",claim()))).status,401);
  assert.equal((await linked("evt_http_expired12",claim(),
    signed("evt_http_expired12",claim(),String(Math.floor(Date.now()/1000)-400)))).status,401);
  const unboundEvent="evt_http_unbound_12";
  assert.equal((await send(unboundEvent,claim(),signed(unboundEvent,claim()))).status,202);
  assert.equal((await linked(unboundEvent)).status,409,
    "Digest-only replay cannot gain receipt authority");
  sql("INSERT INTO payment(receipt,order_number,amount,method,destination_account,status,provider_settlement_state) "+
    "VALUES ('PAY-HTTP-REVERSED','OT-HTTP-LINK',1.25,'card','Synthetic account','reversed','unverified');");
  assert.equal((await linked("evt_http_reversed12",claim("PAY-HTTP-REVERSED"))).status,409);
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate"),"1");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id LIKE 'evt_http_missing%' OR event_id LIKE 'evt_http_wrong%'"),"0");
  assert.equal(sql("SELECT charge_total::text||'/'||available::text "+
    "FROM work_order WHERE number='OT-HTTP-LINK'"),before);
  assert.equal(sql("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-HTTP-LINK'"),"unverified");
  // A lost HTTP response may be retried after the original receipt is
  // reversed; it must report the original event without creating new proof.
  sql("BEGIN; UPDATE payment SET status='reversed' WHERE receipt='PAY-HTTP-LINK'; "+
    "UPDATE work_order SET available=1.25 WHERE number='OT-HTTP-LINK'; COMMIT;");
  assert.equal(sql("SELECT available::text FROM work_order WHERE number='OT-HTTP-LINK'"),"1.25");
  assert.equal((await linked(eventLinked)).status,200,
    "Identical signed event must remain a duplicate after reversal");
  assert.equal((await linked("evt_http_after_reverse_12")).status,409,
    "A new signed event cannot attach to an already reversed receipt");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate"),"1");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id='evt_http_after_reverse_12'"),"0");
  assert.equal(sql("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-HTTP-LINK'"),"unverified");
  console.log("PROTOCOLIA_S2C1C4A_HTTP_UNIQUE_BINDING_PASS "+build.target);
  console.log("PROTOCOLIA_S2C1C3C_SIGNED_REVERSAL_REPLAY_PASS "+build.target);
  console.log("PROTOCOLIA_S2C1C3B_SIGNED_RECEIPT_HTTP_PASS "+build.target+
    " 1 accepted/9 duplicate, signed exact receipt match, no settlement");
  console.log("PROTOCOLIA_S2C1C2_PROVIDER_HTTP_PASS "+build.target+
    " 1 accepted/9 duplicate, signed conflict, tamper, stale, no human auth, no settlement");
}finally{
  if(started)docker(["down","-v","--remove-orphans"],true);
  rmSync(scratch,{recursive:true,force:true});
}
