#!/usr/bin/env node
// Real, disposable PostgreSQL oracle for the generated S2c-1c1 inbox.
// NO webhook endpoint, provider call, settlement or live financial operation.
import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

const root=resolve(process.argv[2]??"");
const build=JSON.parse(readFileSync(join(root,"protocolia-build.json"),"utf8"));
assert.ok(["nestjs","modular-spring"].includes(build.target));
const schema=readFileSync(join(root,build.target==="nestjs"?
  "src/schema.sql":"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
assert.match(schema,/CREATE TABLE protocolia_provider_envelope_inbox/);
assert.match(schema,/CREATE FUNCTION protocolia_record_provider_envelope_digest/);
const scratch=mkdtempSync(join(tmpdir(),"pia-provider-inbox-"));
const project="pia_provider_"+randomBytes(5).toString("hex");
const env={PROTOCOLIA_DB_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_MANAGER_PASSWORD:"synthetic_manager",
  PROTOCOLIA_READER_PASSWORD:"synthetic_reader"};
writeFileSync(join(scratch,"env"),Object.entries(env).map(([k,v])=>k+"="+v).join("\n")+"\n");
const composeArgs=["compose","--project-name",project,"--env-file",join(scratch,"env")];
function docker(args,{input,allowFail=false,timeout=120000}={}){
  const r=spawnSync("docker",[...composeArgs,...args],{
    cwd:root,env:{...process.env,...env},encoding:"utf8",input,timeout,
    maxBuffer:2*1024*1024});
  if(!allowFail&&(r.error||r.status!==0))throw Error(
    "Docker "+args.join(" ")+": "+String(r.stderr||r.error?.message).slice(-2000));
  return r;
}
function sql(query,{allowFail=false}={}){
  return docker(["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
    "-U","protocolia","-d","protocolia","-At"],{input:query+"\n",allowFail});
}
function value(query){return sql(query).stdout.trim();}
const digestA="a".repeat(64),digestB="b".repeat(64);
const literal=x=>"'"+x.replaceAll("'","''")+"'";
const call=(provider,event,digest)=>"SELECT protocolia_record_provider_envelope_digest("+
  [provider,event,digest].map(literal).join(",")+");";
async function concurrent(queries){
  return Promise.all(queries.map(query=>new Promise((resolve,reject)=>{
    const child=spawn("docker",[...composeArgs,"exec","-T","db","psql",
      "-X","-v","ON_ERROR_STOP=1","-U","protocolia","-d","protocolia","-At"],{
      cwd:root,env:{...process.env,...env},stdio:["pipe","pipe","pipe"]});
    let out="",err="";
    child.stdout.on("data",x=>out+=x);
    child.stderr.on("data",x=>err+=x);
    child.on("error",reject);
    child.on("close",code=>code===0?resolve(out.trim()):
      reject(Error("Concurrent PostgreSQL query failed: "+err.slice(-600))));
    child.stdin.end(query+"\n");
  })));
}
let started=false;
try{
  docker(["up","-d","--wait","db"],{timeout:240000});started=true;
  sql(schema);
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox;"),"0");
  const event="evt_12345678";
  const outcomes=await concurrent(Array.from({length:10},()=>
    call("sandbox_provider",event,digestA)));
  assert.equal(outcomes.filter(x=>x==="stored").length,1,JSON.stringify(outcomes));
  assert.equal(outcomes.filter(x=>x==="duplicate").length,9,JSON.stringify(outcomes));
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox;"),"1");
  assert.equal(value(call("sandbox_provider",event,digestB)),"conflict");
  assert.equal(value(call("sandbox_provider",event,digestA)),"duplicate");
  assert.equal(value(call("another_provider",event,digestA)),"stored");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox;"),"2");
  assert.equal(value("SELECT payload_sha256 FROM protocolia_provider_envelope_inbox "+
    "WHERE provider_id='sandbox_provider' AND event_id='evt_12345678';"),digestA);
  // The signature key ID is intentionally absent from the uniqueness identity.
  assert.equal(value("SELECT COUNT(*) FROM information_schema.columns WHERE "+
    "table_name='protocolia_provider_envelope_inbox' AND column_name='key_id';"),"0");
  const bad=[
    call("bad/provider","evt_99999999",digestA),
    call("sandbox_provider","short",digestA),
    call("sandbox_provider","evt_bad\nline",digestA),
    call("sandbox_provider","evt_99999999","A".repeat(64)),
    call("sandbox_provider","evt_99999999","0".repeat(63))
  ];
  for(const q of bad)assert.notEqual(sql(q,{allowFail:true}).status,0,
    "Invalid provider identity/digest must fail");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox;"),"2");
  // Crash-before-commit means no claim is persisted and the retry can store.
  assert.equal(value("BEGIN; "+call("sandbox_provider","evt_rollback1",digestA)+
    " ROLLBACK; SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id='evt_rollback1';").split("\n").at(-1),"0");
  assert.equal(value(call("sandbox_provider","evt_rollback1",digestA)),"stored");
  assert.notEqual(sql("UPDATE protocolia_provider_envelope_inbox "+
    "SET payload_sha256="+literal(digestB)+" WHERE event_id="+literal(event)+";",
    {allowFail:true}).status,0,"Inbox update must be forbidden");
  assert.notEqual(sql("DELETE FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id="+literal(event)+";",{allowFail:true}).status,0,
    "Inbox delete must be forbidden");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox;"),"3");
  assert.equal(value("SELECT COUNT(*) FROM payment;"),"0",
    "Recording an envelope must not mutate receipts");

  // S2c-1c3a: correlate a synthetic candidate to an existing exact receipt.
  // No signature validation happens in SQL and NO payment is ever marked settled.
  sql("INSERT INTO customer(customer_code,name,contact_note) VALUES "+
    "('C-CAND','Synthetic Customer','Isolated PostgreSQL proof');");
  sql("INSERT INTO vehicle(plate,customer_code,model_name,mileage_km) VALUES "+
    "('CAR-CAND','C-CAND','Synthetic Vehicle',0);");
  sql("INSERT INTO work_order(number,vehicle_plate,symptom,charge_total,opening_balance,available,status) "+
    "VALUES ('OT-CAND','CAR-CAND','Synthetic receipt proof',1.25,1.25,0,'opened');");
  sql("INSERT INTO payment(receipt,order_number,amount,method,destination_account,status,provider_settlement_state) "+
    "VALUES ('PAY-CAND','OT-CAND',1.25,'card','Synthetic account','posted','unverified');");
  const candidate=(event,digest,receipt="PAY-CAND",order="OT-CAND",amount="1.25")=>
    "SELECT protocolia_record_provider_receipt_candidate("+
    ["sandbox_provider",event,digest,receipt,order].map(literal).join(",")+
    ","+amount+"::numeric);";
  const before=value("SELECT charge_total::text||'/'||available::text FROM work_order WHERE number='OT-CAND';");
  assert.equal(value(candidate("evt_cand_missing",digestA,"NOT-THERE")),"missing");
  assert.equal(value(candidate("evt_cand_badord",digestA,"PAY-CAND","WRONG")),"mismatch");
  assert.equal(value(candidate("evt_cand_badamt",digestA,"PAY-CAND","OT-CAND","1.26")),"mismatch");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate;"),"0");
  // An earlier digest-only inbox claim cannot be retroactively relabeled as
  // receipt-linked proof, even with the identical digest.
  assert.equal(value(call("sandbox_provider","evt_unbound_12345678",digestA)),"stored");
  assert.equal(value(candidate("evt_unbound_12345678",digestA)),"conflict");
  sql("INSERT INTO payment(receipt,order_number,amount,method,destination_account,status,provider_settlement_state) "+
    "VALUES ('PAY-REVERSED','OT-CAND',1.25,'card','Synthetic account','reversed','unverified');");
  assert.equal(value(candidate("evt_cand_reversed",digestA,"PAY-REVERSED")),"mismatch");
  for(const [event,amount] of [
    ["evt_cand_zero","0.00"],["evt_cand_negative","-1.25"],
    ["evt_cand_overflow","1000000000000.00"]
  ])assert.notEqual(sql(candidate(event,digestA,"PAY-CAND","OT-CAND",amount),
    {allowFail:true}).status,0,"Invalid candidate money must be rejected");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate;"),"0");
  const candidateEvent="evt_candidate_12345678";
  const results=await concurrent(Array.from({length:10},()=>candidate(candidateEvent,digestA)));
  assert.equal(results.filter(x=>x==="stored").length,1,JSON.stringify(results));
  assert.equal(results.filter(x=>x==="duplicate").length,9,JSON.stringify(results));
  assert.equal(value(candidate(candidateEvent,digestB)),"conflict");
  assert.equal(value(candidate(candidateEvent,digestA,"PAY-CAND","OT-CAND","1.26")),"mismatch");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate;"),"1");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox WHERE event_id="+
    literal(candidateEvent)+";"),"1");
  assert.equal(value("SELECT amount::text FROM protocolia_provider_receipt_candidate WHERE event_id="+
    literal(candidateEvent)+";"),"1.25");
  assert.equal(value("SELECT charge_total::text||'/'||available::text FROM work_order WHERE number='OT-CAND';"),before);
  assert.equal(value("SELECT provider_settlement_state FROM payment WHERE receipt='PAY-CAND';"),"unverified");
  assert.equal(value("BEGIN; "+candidate("evt_cand_rollback",digestA)+
    " ROLLBACK; SELECT COUNT(*) FROM protocolia_provider_receipt_candidate "+
    "WHERE event_id='evt_cand_rollback';").split("\n").at(-1),"0");
  assert.equal(value(candidate("evt_cand_rollback",digestA)),"stored");
  assert.notEqual(sql("UPDATE protocolia_provider_receipt_candidate SET amount=2.00 "+
    "WHERE event_id="+literal(candidateEvent)+";",{allowFail:true}).status,0);
  assert.notEqual(sql("DELETE FROM protocolia_provider_receipt_candidate "+
    "WHERE event_id="+literal(candidateEvent)+";",{allowFail:true}).status,0);
  assert.notEqual(sql(candidate("evt_cand_fraction",digestA,"PAY-CAND","OT-CAND","1.251"),
    {allowFail:true}).status,0);
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate;"),"2");
  // Once a candidate was committed, reversing its receipt must not turn an
  // identical provider retry into a new business decision or erase history.
  sql("UPDATE payment SET status='reversed' WHERE receipt='PAY-CAND';");
  assert.equal(value(candidate(candidateEvent,digestA)),"duplicate",
    "Identical committed event remains idempotent after receipt reversal");
  assert.equal(value(candidate(candidateEvent,digestB)),"conflict");
  assert.equal(value(candidate("evt_after_reverse_1234",digestA)),"mismatch",
    "New event may not attach to a reversed receipt");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate;"),"2");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox WHERE "+
    "event_id='evt_after_reverse_1234';"),"0");
  assert.equal(value("SELECT provider_settlement_state FROM payment WHERE receipt='PAY-CAND';"),
    "unverified");
  console.log("PROTOCOLIA_S2C1C3C_REVERSAL_REPLAY_PASS "+build.target);
  console.log("PROTOCOLIA_S2C1C3A_RECEIPT_CANDIDATE_PASS "+build.target+
    " exact linked candidate, 1 stored/9 duplicates, no settlement, rollback and immutable");

  console.log("PROTOCOLIA_S2C1C1_PROVIDER_INBOX_PASS "+build.target+
    " 1 stored/9 duplicates, cross-provider, digest conflict, rollback, immutable, no settlement");
}finally{
  if(started)docker(["down","-v","--remove-orphans"],{allowFail:true,timeout:120000});
  rmSync(scratch,{recursive:true,force:true});
}
