#!/usr/bin/env node
// Disposable HTTP+PostgreSQL oracle. Sandbox HMAC, no external provider or settlement.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHmac,randomBytes} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:net";
import {oneShotOverlay} from "../../packages/cli/disposable-one-shot-migrator.mjs";

const root=resolve(process.argv[2]??"");
const build=JSON.parse(readFileSync(join(root,"protocolia-build.json"),"utf8"));
assert.ok(["nestjs","modular-spring"].includes(build.target));
const scratch=mkdtempSync(join(tmpdir(),"pia-provider-http-"));
const project="pia_ckpt_"+randomBytes(5).toString("hex");
const key=randomBytes(32);
const rotatedKey=randomBytes(32);
const env={
  PROTOCOLIA_DB_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_MANAGER_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_READER_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_ALLOW_DEMO_AUTH:"true",
  PROTOCOLIA_PROVIDER_SANDBOX_ENABLED:"true",
  PROTOCOLIA_PROVIDER_SANDBOX_KEY_HEX:"",
  PROTOCOLIA_PROVIDER_SANDBOX_KEYS:"sandbox_1="+key.toString("hex")+",sandbox_2="+rotatedKey.toString("hex")
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
function signed(event,raw=body,timestamp=String(Math.floor(Date.now()/1000)),purpose="inbox",keyId="sandbox_1"){
  const mac=createHmac("sha256",keyId==="sandbox_1"?key:rotatedKey)
    .update("protocolia-provider-proof-v2\n"+purpose+"\n"+keyId+"\n"+timestamp+"\n"+event+"\n")
    .update(raw).digest("hex");
  return {"Content-Type":"application/json","X-ProtocolIA-Key-Id":keyId,
    "X-ProtocolIA-Timestamp":timestamp,"X-ProtocolIA-Event-Id":event,
    "X-ProtocolIA-Signature":"v2="+mac};
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
  // Both active keys authenticate; rotation never creates a second event.
  const rotatedEvent="evt_rotation_12345678";
  assert.equal((await send(rotatedEvent,body,
    signed(rotatedEvent,body,undefined,"inbox","sandbox_2"))).status,202);
  assert.equal((await send(rotatedEvent)).status,200,
    "same event signed by a different active key is still a duplicate");
  assert.equal((await send("evt_unknown_key_12",body,
    signed("evt_unknown_key_12",body,undefined,"inbox","retired_1"))).status,401);
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox"),"3");
  assert.equal(sql("SELECT COUNT(*) FROM payment"),"0");
  const crossEvent="evt_cross_route_12345678";
  assert.equal((await send(crossEvent,body,signed(crossEvent,body,undefined,"receipt-candidate"))).status,401);
  assert.equal((await send(crossEvent,body,signed(crossEvent,body),"/api/_protocolia/provider/sandbox/receipt-candidate")).status,401);
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox"),"3");

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
  const linked=(event,raw=claim(),headers=signed(event,raw,undefined,"receipt-candidate"))=>
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

  // S2c-1c4c: a separate versioned, strictly signed lifecycle HTTP route.
  // Reports may arrive out of order, but they never change ledger authority.
  const lifecyclePath="/api/_protocolia/provider/sandbox/lifecycle-observation";
  const lifeClaim=(sequence="3",phase="reported_success",
    candidateEventId=eventLinked,receiptId="PAY-HTTP-LINK",
    orderId="OT-HTTP-LINK",amount="1.25")=>Buffer.from(JSON.stringify({
      version:"lifecycle-observation.v1",candidateEventId,receiptId,
      orderId,amount,sequence,phase
    }));
  const lifecycle=(event,raw=lifeClaim(),headers=signed(event,raw,undefined,"lifecycle-observation"))=>
    send(event,raw,headers,lifecyclePath);
  const lifeEvent="evt_life_http_00000003";
  const lifeResponses=await Promise.all(Array.from({length:10},()=>lifecycle(lifeEvent)));
  assert.equal(lifeResponses.filter(x=>x.status===202).length,1,JSON.stringify(lifeResponses));
  assert.equal(lifeResponses.filter(x=>x.status===200).length,9,JSON.stringify(lifeResponses));
  assert.equal((await lifecycle("evt_life_http_00000001",
    lifeClaim("1","reported_pending"))).status,202);
  assert.equal((await lifecycle("evt_life_http_00000002",
    lifeClaim("2","reported_failure"))).status,202);
  assert.equal(sql("SELECT string_agg(event_sequence::text,',' ORDER BY event_sequence) "+
    "FROM protocolia_provider_lifecycle_observation"),"1,2,3");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_lifecycle_observation"),"3");
  assert.equal((await lifecycle("evt_life_seq_conflict",lifeClaim("2"))).status,409);
  assert.equal((await lifecycle(lifeEvent,lifeClaim("3","reported_reversal"))).status,409);
  assert.equal((await lifecycle("evt_life_missing_cand",
    lifeClaim("4","reported_pending","evt_not_a_candidate_12"))).status,404);
  assert.equal((await lifecycle("evt_life_wrong_receipt",
    lifeClaim("4","reported_pending",eventLinked,"OTHER-RECEIPT"))).status,404);
  assert.equal((await lifecycle("evt_life_wrong_order",
    lifeClaim("4","reported_pending",eventLinked,"PAY-HTTP-LINK","OTHER-ORDER"))).status,409);
  assert.equal((await lifecycle("evt_life_wrong_amount",
    lifeClaim("4","reported_pending",eventLinked,"PAY-HTTP-LINK","OT-HTTP-LINK","1.26"))).status,409);
  for(const [event,raw] of [
    ["evt_life_bad_seq_zero",lifeClaim("0")],
    ["evt_life_bad_seq_lead",lifeClaim("03")],
    ["evt_life_bad_seq_big",lifeClaim("2147483648")],
    ["evt_life_bad_seq_float",lifeClaim("1.5")],
    ["evt_life_bad_amount",lifeClaim("4","reported_pending",eventLinked,
      "PAY-HTTP-LINK","OT-HTTP-LINK","1.251")],
    ["evt_life_bad_phase",lifeClaim("4","settled")],
    ["evt_life_bad_version",Buffer.from(lifeClaim("4").toString().replace(
      "lifecycle-observation.v1","lifecycle-observation.v2"))],
    ["evt_life_extra_field",Buffer.from(lifeClaim("4").toString().replace(
      '"phase":"reported_success"}','"phase":"reported_success","settled":true}'))],
    ["evt_life_duplicate_key",Buffer.from(lifeClaim("4").toString().replace(
      '"sequence":"4",','"sequence":"4","sequence":"4",'))],
    ["evt_life_json_number",Buffer.from(lifeClaim("4").toString().replace(
      '"sequence":"4"','"sequence":4'))]
  ])assert.equal((await lifecycle(event,raw)).status,400,event);
  const tamperedLife=lifeClaim("4");
  assert.equal((await lifecycle("evt_life_tampered_12",tamperedLife,
    signed("evt_life_tampered_12",lifeClaim("5"),undefined,"lifecycle-observation"))).status,401);
  assert.equal((await lifecycle("evt_life_expired_123",lifeClaim("4"),
    signed("evt_life_expired_123",lifeClaim("4"),
      String(Math.floor(Date.now()/1000)-400),"lifecycle-observation"))).status,401);
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_lifecycle_observation"),"3");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id LIKE 'evt_life_%'"),"3");
  assert.equal(sql("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-HTTP-LINK'"),"unverified");
  assert.equal(sql("SELECT charge_total::text||'/'||available::text "+
    "FROM work_order WHERE number='OT-HTTP-LINK'"),before);

  assert.equal((await linked(eventLinked,claim(),
    signed(eventLinked,claim(),undefined,"receipt-candidate","sandbox_2"))).status,200,
    "key rotation cannot create a second receipt candidate");
  assert.equal((await lifecycle(lifeEvent,lifeClaim(),
    signed(lifeEvent,lifeClaim(),undefined,"lifecycle-observation","sandbox_2"))).status,200,
    "key rotation cannot create a second lifecycle observation");
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
    signed("evt_http_tamper_12",claim(),undefined,"receipt-candidate"))).status,401);
  assert.equal((await linked("evt_http_expired12",claim(),
    signed("evt_http_expired12",claim(),String(Math.floor(Date.now()/1000)-400),"receipt-candidate"))).status,401);
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
  assert.equal((await lifecycle(lifeEvent)).status,200,
    "Signed lifecycle replay remains idempotent after internal reversal");
  assert.equal((await lifecycle("evt_life_after_reversal",lifeClaim("4"))).status,409,
    "New lifecycle observations must reject reversed receipts");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_lifecycle_observation"),"3");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id='evt_life_after_reversal'"),"0");
  assert.equal((await linked("evt_http_after_reverse_12")).status,409,
    "A new signed event cannot attach to an already reversed receipt");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate"),"1");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id='evt_http_after_reverse_12'"),"0");
  assert.equal(sql("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-HTTP-LINK'"),"unverified");
  // S2c-1c4g: the HTTP receiver must not materialize an unbounded body.
  // Verify the exact 64 KiB boundary, Content-Length and chunked transfer
  // against both independently generated targets, with no financial mutation.
  const envelopeCount=Number(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox"));
  const paddingPrefix='{"padding":"',paddingSuffix='"}';
  const exactBody=Buffer.from(paddingPrefix+
    "x".repeat(65536-Buffer.byteLength(paddingPrefix+paddingSuffix))+paddingSuffix);
  assert.equal(exactBody.length,65536);
  assert.equal((await send("evt_body_exact_12345678",exactBody)).status,202);
  const tooLarge=Buffer.from(paddingPrefix+
    "x".repeat(65537-Buffer.byteLength(paddingPrefix+paddingSuffix))+paddingSuffix);
  assert.equal(tooLarge.length,65537);
  assert.ok([400,413].includes((await send("evt_body_large_12345678",tooLarge)).status),
    "oversized declared-length request must be rejected");
  const chunkedEvent="evt_body_chunked_12345678";
  const chunked=await fetch(base+path,{
    method:"POST",headers:signed(chunkedEvent,tooLarge),
    body:new ReadableStream({start(controller){
      controller.enqueue(tooLarge);controller.close();
    }}),duplex:"half",signal:AbortSignal.timeout(20000)
  });
  assert.ok([400,413].includes(chunked.status),
    "oversized unknown-length/chunked request must be rejected");
  assert.equal(Number(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox")),
    envelopeCount+1,"only the valid exact-boundary request may persist");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate"),"1");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_lifecycle_observation"),"3");
  assert.equal(sql("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-HTTP-LINK'"),"unverified");
  // S2c-1c4p: end-to-end HMAC HTTP with a DB identity unavailable to the
  // ordinary application. Exercise the actual operator-reviewed SQL split,
  // not merely a second connection string pointing to the same superuser.
  const runtimeRole="pia_http_runtime_"+randomBytes(4).toString("hex");
  const ingressRole="pia_http_ingress_"+randomBytes(4).toString("hex");
  const ownerRole="pia_http_owner_"+randomBytes(4).toString("hex");
  const runtimePassword=randomBytes(24).toString("hex");
  const ingressPassword=randomBytes(24).toString("hex");
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  sql("CREATE ROLE "+ownerRole+"; CREATE ROLE "+runtimeRole+
    " LOGIN PASSWORD "+quote(runtimePassword)+"; CREATE ROLE "+ingressRole+
    " LOGIN PASSWORD "+quote(ingressPassword)+";");
  sql("ALTER SCHEMA public OWNER TO "+ownerRole+"; "+
    "GRANT SELECT ON payment TO "+ownerRole+"; "+
    "GRANT UPDATE(status) ON payment TO "+ownerRole+";");
  for(const table of [
    "protocolia_provider_envelope_inbox",
    "protocolia_provider_receipt_candidate",
    "protocolia_provider_lifecycle_observation"
  ])sql("ALTER TABLE public."+table+" OWNER TO "+ownerRole+";");
  for(const signature of [
    "protocolia_provider_envelope_immutable()",
    "protocolia_record_provider_envelope_digest(text,text,text)",
    "protocolia_record_provider_receipt_candidate(text,text,text,text,text,numeric)",
    "protocolia_record_provider_lifecycle_observation(text,text,text,text,text,text,numeric,numeric,text)",
    "protocolia_provider_lifecycle_causal_projection(text)",
    "protocolia_provider_receipt_integrity_projection(text)"
  ])sql("ALTER FUNCTION public."+signature+" OWNER TO "+ownerRole+";");
  const isolation=readFileSync(join(root,
    "protocolia-provider-journal-runtime-isolation.sql"),"utf8");
  sql("BEGIN; SET ROLE "+ownerRole+
    "; SET LOCAL protocolia.provider_runtime_role="+quote(runtimeRole)+
    "; SET LOCAL protocolia.provider_ingress_role="+quote(ingressRole)+
    "; "+isolation+" COMMIT;");
  const writer="public.protocolia_record_provider_envelope_digest(text,text,text)";
  assert.equal(sql("SELECT has_function_privilege("+quote(runtimeRole)+","+
    quote(writer)+",'EXECUTE');"),"f");
  assert.equal(sql("SELECT has_function_privilege("+quote(ingressRole)+","+
    quote(writer)+",'EXECUTE');"),"t");
  const deniedDirect=docker(["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
    "-U","protocolia","-d","protocolia","-Atc",
    "SET ROLE "+runtimeRole+"; SELECT public.protocolia_record_provider_envelope_digest"+
    "('sandbox_provider','evt_denied_http_12345678','"+ "a".repeat(64)+"');"],true);
  assert.notEqual(deniedDirect.status,0);
  assert.match(deniedDirect.stderr,/permission denied/);
  env.PROTOCOLIA_RUNTIME_DB_USER=runtimeRole;
  env.PROTOCOLIA_RUNTIME_DB_PASSWORD=runtimePassword;
  env.PROTOCOLIA_MIGRATION_DB_USER="protocolia";
  env.PROTOCOLIA_MIGRATION_DB_PASSWORD=env.PROTOCOLIA_DB_PASSWORD;
  env.PROTOCOLIA_PROVIDER_INGRESS_DB_USER=ingressRole;
  env.PROTOCOLIA_PROVIDER_INGRESS_DB_PASSWORD=ingressPassword;
  writeFileSync(join(scratch,"env"),Object.entries(env).map(([k,v])=>k+"="+v).join("\n")+"\n");
  docker(["up","-d","--force-recreate","--wait","app"]);
  await ready();
  const ingressEvent="evt_http_split_12345678";
  const ingressResponses=await Promise.all(Array.from({length:10},()=>
    send(ingressEvent)));
  assert.equal(ingressResponses.filter(x=>x.status===202).length,1,
    JSON.stringify(ingressResponses));
  assert.equal(ingressResponses.filter(x=>x.status===200).length,9,
    JSON.stringify(ingressResponses));
  assert.equal((await send(ingressEvent,changed,signed(ingressEvent,changed))).status,409);
  assert.equal((await send("evt_http_split_bad_sig",changed,
    signed("evt_http_split_bad_sig",body))).status,401);
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id="+quote(ingressEvent)),"1");
  sql("INSERT INTO work_order(number,vehicle_plate,symptom,charge_total,opening_balance,available,status) "+
    "VALUES ('OT-HTTP-SPLIT','CAR-HTTP-LINK','Isolated HMAC test',1.25,1.25,0,'opened');");
  sql("INSERT INTO payment(receipt,order_number,amount,method,destination_account,status,provider_settlement_state) "+
    "VALUES ('PAY-HTTP-SPLIT','OT-HTTP-SPLIT',1.25,'card','Synthetic account','posted','unverified');");
  const candidateEvent="evt_http_split_candidate_12345678";
  const candidateBody=claim("PAY-HTTP-SPLIT","OT-HTTP-SPLIT");
  assert.equal((await linked(candidateEvent,candidateBody)).status,202);
  assert.equal((await linked(candidateEvent,candidateBody)).status,200);
  const lifeEventSplit="evt_http_split_life_12345678";
  const lifeBodySplit=lifeClaim("1","reported_pending",candidateEvent,
    "PAY-HTTP-SPLIT","OT-HTTP-SPLIT");
  assert.equal((await lifecycle(lifeEventSplit,lifeBodySplit)).status,202);
  assert.equal((await lifecycle(lifeEventSplit,lifeBodySplit)).status,200);
  assert.equal(sql("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-HTTP-SPLIT'"),"unverified");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate "+
    "WHERE event_id="+quote(candidateEvent)),"1");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_lifecycle_observation "+
    "WHERE event_id="+quote(lifeEventSplit)),"1");
  // A low-privilege ingress transaction interrupted before COMMIT must not
  // leave a replay claim; the later signed HTTP delivery must still succeed.
  const rollbackEvent="evt_http_split_rollback_12345678";
  sql("BEGIN; SET ROLE "+ingressRole+
    "; SELECT protocolia_record_provider_envelope_digest('sandbox_provider',"+
    quote(rollbackEvent)+","+quote("b".repeat(64))+"); ROLLBACK;");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id="+quote(rollbackEvent)),"0");
  assert.equal((await send(rollbackEvent)).status,202);
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id="+quote(rollbackEvent)),"1");
  // Revoking the ingress writer mid-flight must fail closed with no claim.
  // Restore the reviewed grant and prove the *same* signed event is recoverable.
  const revokedEvent="evt_http_split_revoked_12345678";
  sql("SET ROLE "+ownerRole+"; REVOKE EXECUTE ON FUNCTION "+writer+
    " FROM "+ingressRole+";");
  const rejected=await send(revokedEvent);
  assert.ok([500,503].includes(rejected.status),
    "Revoked ingress function must never report an accepted event: "+rejected.status);
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id="+quote(revokedEvent)),"0");
  sql("SET ROLE "+ownerRole+"; GRANT EXECUTE ON FUNCTION "+writer+
    " TO "+ingressRole+";");
  assert.equal((await send(revokedEvent)).status,202);
  // Restart with the same distinct credentials: persisted evidence must remain
  // replay-safe, while the runtime DB principal still cannot fabricate writes.
  docker(["restart","app"]);
  await ready();
  assert.equal((await send(ingressEvent)).status,200);
  assert.equal((await linked(candidateEvent,candidateBody)).status,200);
  assert.equal((await lifecycle(lifeEventSplit,lifeBodySplit)).status,200);
  assert.equal(sql("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-HTTP-SPLIT'"),"unverified");
  console.log("PROTOCOLIA_S2C1C4P_SIGNED_HTTP_DISTINCT_DB_PRINCIPAL_PASS "+build.target+
    " real split ACL, 10-way replay, candidate/lifecycle, bad HMAC, restart, no settlement");

  // S2c-1c4q: a second, genuinely isolated lifecycle on the SAME populated
  // disposable PostgreSQL. One pinned image is used first as a one-shot
  // migrator, then as HTTP runtime; only the runtime receives HMAC ingress
  // credentials, and only the migrator receives privileged SQL credentials.
  // The existing legacy Compose remains backward compatible, not secure.
  const existingApp=docker(["ps","-q","app"]).stdout.trim();
  assert.match(existingApp,/^[a-f0-9]{12,64}$/);
  const inspected=spawnSync("docker",["inspect","--format","{{.Image}}",existingApp],
    {encoding:"utf8",timeout:15000});
  assert.equal(inspected.status,0,inspected.stderr);
  const imageId=inspected.stdout.trim();
  assert.match(imageId,/^sha256:[a-f0-9]{64}$/);
  const overlay=join(scratch,"provider-one-shot.yaml");
  writeFileSync(overlay,oneShotOverlay(imageId,build.target,
    {providerIngress:true}),{mode:0o600,flag:"wx"});
  const isolatedBase=[...compose.slice(0,1),
    "--project-name",project,"--env-file",join(scratch,"env"),
    "-f",join(root,"compose.yaml"),"-f",overlay];
  const isolated=(args,allowFail=false)=>{
    const result=spawnSync("docker",[...isolatedBase,...args],{
      cwd:root,env:{...process.env,...env},encoding:"utf8",
      timeout:600000,maxBuffer:3*1024*1024});
    if(!allowFail&&(result.error||result.status!==0))
      throw Error("Isolated Compose "+args.join(" ")+": "+
        String(result.stderr||result.error?.message).slice(-1800));
    return result;
  };
  // PostgreSQL information_schema only lists columns visible to the role.
  // Read-only grants are sufficient for the generated runtime readiness gate;
  // never grant runtime direct journal DML or settlement writes.
  const readable=sql("SELECT tablename FROM pg_tables WHERE schemaname='public' "+
    "AND tablename NOT LIKE 'protocolia_%' AND tablename<>'flyway_schema_history' "+
    "ORDER BY tablename").split("\n").filter(Boolean);
  for(const table of readable){
    assert.match(table,/^[a-z][a-z0-9_]*$/);
    sql("GRANT SELECT ON TABLE public."+table+" TO "+runtimeRole);
  }
  docker(["stop","app"]);
  const config=JSON.parse(isolated(["--profile","migration","config","--format","json"]).stdout);
  const appConfig=config.services.app, migratorConfig=config.services.migrate;
  assert.equal(appConfig.image,imageId);
  assert.equal(migratorConfig.image,imageId);
  assert.equal(appConfig.environment.PROTOCOLIA_EXECUTION_MODE,"runtime");
  assert.equal(migratorConfig.environment.PROTOCOLIA_EXECUTION_MODE,"migrate");
  assert.equal(appConfig.environment.PROTOCOLIA_JDBC_USER,runtimeRole);
  assert.equal(appConfig.environment.PROTOCOLIA_PROVIDER_INGRESS_JDBC_USER,ingressRole);
  assert.equal(migratorConfig.environment.PROTOCOLIA_JDBC_USER,"protocolia");
  assert.deepEqual(migratorConfig.profiles,["migration"]);
  for(const key of ["PROTOCOLIA_MIGRATION_JDBC_USER",
    "PROTOCOLIA_MIGRATION_JDBC_PASSWORD","PROTOCOLIA_DB_PASSWORD"]){
    assert.equal(appConfig.environment[key],undefined,
      "Privileged SQL secret leaked into HTTP runtime: "+key);
  }
  for(const key of ["PROTOCOLIA_PROVIDER_INGRESS_JDBC_USER",
    "PROTOCOLIA_PROVIDER_INGRESS_JDBC_PASSWORD"]){
    assert.equal(migratorConfig.environment[key],undefined,
      "HMAC ingress identity leaked into migrator: "+key);
  }
  assert.ok(appConfig.build==null,"Pinned runtime must not rebuild");
  // Runtime cannot start before a successful one-shot schema handoff.
  const premature=isolated(["run","--rm","--no-deps","app"],true);
  assert.notEqual(premature.status,0,"Missing migration handoff must fail closed");
  assert.equal(sql("SELECT to_regclass('public.protocolia_migration_handoff_v1') IS NULL"),"t");
  isolated(["run","--rm","migrate"]);
  assert.equal(sql("SELECT COUNT(*) FROM public.protocolia_migration_handoff_v1 "+
    "WHERE image_digest='"+imageId.slice(7)+"'"),"1");
  isolated(["up","-d","--no-deps","--force-recreate","app"]);
  await ready();
  const pinnedApp=isolated(["ps","-q","app"]).stdout.trim();
  assert.match(pinnedApp,/^[a-f0-9]{12,64}$/);
  const inspectRuntime=spawnSync("docker",["inspect","--format",
    "{{json .Config.Env}}",pinnedApp],{encoding:"utf8",timeout:15000});
  assert.equal(inspectRuntime.status,0);
  const runtimeEnv=JSON.parse(inspectRuntime.stdout);
  assert.ok(runtimeEnv.includes("PROTOCOLIA_EXECUTION_MODE=runtime"));
  assert.ok(runtimeEnv.includes("PROTOCOLIA_JDBC_USER="+runtimeRole));
  assert.ok(runtimeEnv.includes("PROTOCOLIA_PROVIDER_INGRESS_JDBC_USER="+ingressRole));
  assert.ok(!runtimeEnv.some(v=>v.startsWith("PROTOCOLIA_MIGRATION_JDBC_")||
    v.startsWith("PROTOCOLIA_DB_PASSWORD=")));
  assert.equal(isolated(["ps","-q","migrate"]).stdout.trim(),"",
    "Privileged one-shot migrator must not remain running");
  const pinnedEvent="evt_http_pinned_12345678";
  const pinnedReplies=await Promise.all(Array.from({length:10},()=>send(pinnedEvent)));
  assert.equal(pinnedReplies.filter(x=>x.status===202).length,1);
  assert.equal(pinnedReplies.filter(x=>x.status===200).length,9);
  assert.equal((await send("evt_http_pinned_bad_sig",changed,
    signed("evt_http_pinned_bad_sig",body))).status,401);
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id='"+pinnedEvent+"'"),"1");
  assert.equal(sql("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-HTTP-SPLIT'"),"unverified");
  isolated(["restart","app"]);
  await ready();
  assert.equal((await send(pinnedEvent)).status,200);
  console.log("PROTOCOLIA_S2C1C4Q_PINNED_MIGRATOR_RUNTIME_SECRET_BOUNDARY_PASS "+
    build.target+" one-shot handoff, no shared SQL credentials, HMAC replay, restart");

  console.log("PROTOCOLIA_S2C1C4G_BOUNDED_SANDBOX_HTTP_PASS "+build.target);
  console.log("PROTOCOLIA_S2C1C4C_SIGNED_LIFECYCLE_HTTP_PASS "+build.target+
    " 1 stored/9 duplicate, out-of-order 3-1-2, no settlement");
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
