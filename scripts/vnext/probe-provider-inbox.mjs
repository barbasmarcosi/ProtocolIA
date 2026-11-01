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
  const candidate=(event,digest,receipt="PAY-CAND",order="OT-CAND",amount="1.25",
    provider="sandbox_provider")=>
    "SELECT protocolia_record_provider_receipt_candidate("+
    [provider,event,digest,receipt,order].map(literal).join(",")+
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
  // S2c-1c4a: a second event, even from another provider, cannot silently
  // claim the same receipt as a new candidate or create an inbox fragment.
  assert.equal(value(candidate("evt_second_same_receipt",digestA)),"conflict");
  assert.equal(value(candidate("evt_other_provider_123",digestA,
    "PAY-CAND","OT-CAND","1.25","another_provider")),"conflict");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox WHERE "+
    "event_id IN ('evt_second_same_receipt','evt_other_provider_123');"),"0");
  // Ten distinct event IDs racing to claim a fresh receipt: exactly one wins.
  sql("INSERT INTO work_order(number,vehicle_plate,symptom,charge_total,opening_balance,available,status) "+
    "VALUES ('OT-CAND-RACE','CAR-CAND','Synthetic competing events',1.25,1.25,0,'opened');");
  sql("INSERT INTO payment(receipt,order_number,amount,method,destination_account,status,provider_settlement_state) "+
    "VALUES ('PAY-CAND-RACE','OT-CAND-RACE',1.25,'card','Synthetic account','posted','unverified');");
  const racingEvents=Array.from({length:10},(_,i)=>"evt_race_"+String(i).padStart(8,"0"));
  const racing=await concurrent(racingEvents.map(event=>candidate(event,digestA,
    "PAY-CAND-RACE","OT-CAND-RACE")));
  assert.equal(racing.filter(x=>x==="stored").length,1,JSON.stringify(racing));
  assert.equal(racing.filter(x=>x==="conflict").length,9,JSON.stringify(racing));
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate "+
    "WHERE receipt_id='PAY-CAND-RACE';"),"1");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id LIKE 'evt_race_%';"),"1");
  assert.equal(value("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-CAND-RACE';"),"unverified");

  // S2c-1c4b: SQL-only synthetic lifecycle observations. These are NOT
  // provider-authorized settlement, refunds or changes to the payment ledger.
  const observation=(event,seq,phase="reported_pending",
    candidateId=candidateEvent,receipt="PAY-CAND",order="OT-CAND",
    amount="1.25",provider="sandbox_provider",digest=digestA)=>
    "SELECT protocolia_record_provider_lifecycle_observation("+
    [provider,event,digest,candidateId,receipt,order].map(literal).join(",")+
    ","+amount+"::numeric,"+seq+"::numeric,"+literal(phase)+");";
  assert.match(schema,/CREATE TABLE protocolia_provider_lifecycle_observation/);
  assert.match(schema,/CREATE FUNCTION protocolia_record_provider_lifecycle_observation/);
  assert.equal(value(observation("evt_life_00000003",3,"reported_success")),"stored");
  assert.equal(value(observation("evt_life_00000001",1)),"stored");
  assert.equal(value(observation("evt_life_00000002",2)),"stored");
  assert.equal(value("SELECT string_agg(event_sequence::text,',' ORDER BY event_sequence) "+
    "FROM protocolia_provider_lifecycle_observation WHERE receipt_id='PAY-CAND';"),"1,2,3",
    "Out-of-order events are journaled, not applied as payment state");
  const sameEvent="evt_life_same_0004";
  const concurrentLife=await concurrent(Array.from({length:10},()=>observation(sameEvent,4)));
  assert.equal(concurrentLife.filter(x=>x==="stored").length,1,JSON.stringify(concurrentLife));
  assert.equal(concurrentLife.filter(x=>x==="duplicate").length,9,JSON.stringify(concurrentLife));
  const competingLife=await concurrent(Array.from({length:10},(_,i)=>
    observation("evt_life_race_"+String(i).padStart(8,"0"),5)));
  assert.equal(competingLife.filter(x=>x==="stored").length,1,JSON.stringify(competingLife));
  assert.equal(competingLife.filter(x=>x==="conflict").length,9,JSON.stringify(competingLife));
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id LIKE 'evt_life_race_%';"),"1",
    "Competing sequence numbers must leave no orphan inbox envelopes");
  assert.equal(value(observation(sameEvent,4,"reported_failure")),"conflict");
  assert.equal(value(observation(sameEvent,4,"reported_pending",candidateEvent,
    "PAY-CAND","OT-CAND","1.25","sandbox_provider",digestB)),"conflict");
  assert.equal(value(observation("evt_life_seq_conflict",4)),"conflict");
  assert.equal(value(observation("evt_life_missing_01",6,"reported_pending","unknown_candidate")),"missing");
  assert.equal(value(observation("evt_life_other_provider",6,"reported_pending",
    candidateEvent,"PAY-CAND","OT-CAND","1.25","another_provider")),"missing");
  assert.equal(value(observation("evt_life_bad_order_1",6,"reported_pending",
    candidateEvent,"PAY-CAND","wrong")),"mismatch");
  assert.equal(value(observation("evt_life_bad_amount",6,"reported_pending",
    candidateEvent,"PAY-CAND","OT-CAND","1.26")),"mismatch");
  for(const [event,seq,phase,amount] of [
    ["evt_life_zero_0000","0","reported_pending","1.25"],
    ["evt_life_negative_1","-1","reported_pending","1.25"],
    ["evt_life_fraction_1","1.5","reported_pending","1.25"],
    ["evt_life_large_000","2147483648","reported_pending","1.25"],
    ["evt_life_bad_phase1","6","settled","1.25"],
    ["evt_life_bad_money1","6","reported_pending","1.251"]
  ])assert.notEqual(sql(observation(event,seq,phase,candidateEvent,
    "PAY-CAND","OT-CAND",amount),{allowFail:true}).status,0,
    "Malformed lifecycle observation must fail closed: "+event);
  const rollbackLife=observation("evt_life_rollback_6",6,"reported_reversal");
  assert.equal(value("BEGIN; "+rollbackLife+" ROLLBACK; "+
    "SELECT COUNT(*) FROM protocolia_provider_lifecycle_observation "+
    "WHERE event_id='evt_life_rollback_6';").split("\n").at(-1),"0");
  assert.equal(value(rollbackLife),"stored");
  assert.notEqual(sql("UPDATE protocolia_provider_lifecycle_observation "+
    "SET reported_phase='reported_failure' WHERE event_id="+literal(sameEvent)+";",
    {allowFail:true}).status,0);
  assert.notEqual(sql("DELETE FROM protocolia_provider_lifecycle_observation "+
    "WHERE event_id="+literal(sameEvent)+";",{allowFail:true}).status,0);
  // A direct SQL insertion cannot attach a lifecycle row to the wrong candidate.
  assert.notEqual(sql("INSERT INTO protocolia_provider_lifecycle_observation "+
    "(provider_id,event_id,candidate_event_id,receipt_id,order_id,amount,event_sequence,reported_phase) "+
    "VALUES ('sandbox_provider','evt_life_direct_wrong','evt_candidate_12345678',"+
    "'PAY-CAND-RACE','OT-CAND-RACE',1.25,7,'reported_success');",
    {allowFail:true}).status,0);
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_lifecycle_observation "+
    "WHERE receipt_id='PAY-CAND';"),"6");
  assert.equal(value("SELECT provider_settlement_state FROM payment WHERE receipt='PAY-CAND';"),
    "unverified");
  assert.equal(value("SELECT charge_total::text||'/'||available::text FROM work_order "+
    "WHERE number='OT-CAND';"),before);
  // S2c-1c4d: a read-only, single-snapshot causal diagnostic. Neither
  // coherent nor reported_success grants externally verified settlement.
  assert.match(schema,/CREATE FUNCTION protocolia_provider_lifecycle_causal_projection/);
  assert.match(schema,/CREATE FUNCTION protocolia_provider_receipt_integrity_projection/);
  const integrity=receipt=>value("SELECT internal_integrity||'/'||causal_integrity||'/'||"+
    "COALESCE(last_coherent_phase,'none')||'/'||observation_count::text "+
    "FROM protocolia_provider_receipt_integrity_projection("+literal(receipt)+");");
  assert.equal(integrity("UNKNOWN-RECEIPT"),"missing/unobserved/none/0");
  assert.equal(integrity("PAY-REVERSED"),"unbound/unobserved/none/0");
  const causal=receipt=>value("SELECT causal_integrity||'/'||"+
    "COALESCE(last_coherent_phase,'none')||'/'||observation_count::text "+
    "FROM protocolia_provider_lifecycle_causal_projection("+literal(receipt)+");");
  assert.equal(causal("PAY-CAND"),"contradictory/none/6",
    "pending -> failure -> success is contradictory, even with all sequence numbers");
  assert.equal(causal("PAY-CAND-RACE"),"unobserved/none/0");
  const raceCandidateId=value("SELECT event_id FROM protocolia_provider_receipt_candidate "+
    "WHERE receipt_id='PAY-CAND-RACE';");
  assert.ok(raceCandidateId.startsWith("evt_race_"));
  const raceObservation=(event,seq,phase)=>observation(event,seq,phase,raceCandidateId,
    "PAY-CAND-RACE","OT-CAND-RACE");
  const raceBefore=value("SELECT charge_total::text||'/'||available::text "+
    "FROM work_order WHERE number='OT-CAND-RACE';");
  assert.equal(value(raceObservation("evt_proj_race_03",3,"reported_success")),"stored");
  assert.equal(causal("PAY-CAND-RACE"),"gap/none/1",
    "A terminal-looking report at sequence 3 must not imply a complete history");
  assert.equal(integrity("PAY-CAND-RACE"),"causal_gap/gap/none/1");
  assert.equal(value(raceObservation("evt_proj_race_01",1,"reported_pending")),"stored");
  assert.equal(causal("PAY-CAND-RACE"),"gap/none/2");
  assert.equal(value(raceObservation("evt_proj_race_02",2,"reported_pending")),"stored");
  assert.equal(causal("PAY-CAND-RACE"),"coherent/reported_success/3",
    "Filling a gap permits causal classification but never financial authority");
  assert.equal(integrity("PAY-CAND-RACE"),"synthetic_only/coherent/reported_success/3",
    "Even a complete synthetic success is not provider-cleared settlement");
  const raceReversal=raceObservation("evt_proj_race_04",4,"reported_reversal");
  assert.equal(value("BEGIN; "+raceReversal+" ROLLBACK; "+
    "SELECT COUNT(*) FROM protocolia_provider_lifecycle_observation "+
    "WHERE event_id='evt_proj_race_04';").split("\n").at(-1),"0");
  assert.equal(causal("PAY-CAND-RACE"),"coherent/reported_success/3",
    "A rolled-back event must not change the projection");
  assert.equal(value(raceReversal),"stored");
  assert.equal(causal("PAY-CAND-RACE"),"coherent/reported_reversal/4");
  assert.equal(integrity("PAY-CAND-RACE"),"synthetic_reversal/coherent/reported_reversal/4",
    "A coherent synthetic reversal is not a successful or externally cleared payment");
  assert.equal(value(raceObservation("evt_proj_race_05",5,"reported_pending")),"stored");
  assert.equal(causal("PAY-CAND-RACE"),"contradictory/none/5",
    "A new pending report after reversal is not a valid causal transition");
  assert.equal(integrity("PAY-CAND-RACE"),"causal_contradictory/contradictory/none/5");
  // A direct database-level mutation is either rejected by DB constraints or
  // detected by the single-snapshot projection; it must not be trusted as proof.
  for(const [column,valueToSet,expected] of [
    ["amount","1.26","claim_mismatch"],
    ["provider_settlement_state","'invalidxxx'","proof_changed"]
  ]){
    const attempt=sql("BEGIN; UPDATE payment SET "+column+"="+valueToSet+
      " WHERE receipt='PAY-CAND-RACE'; SELECT internal_integrity "+
      "FROM protocolia_provider_receipt_integrity_projection('PAY-CAND-RACE'); ROLLBACK;",
      {allowFail:true});
    if(attempt.status===0)assert.ok(attempt.stdout.includes(expected),
      "Tampered "+column+" must be detected: "+attempt.stdout);
    assert.equal(integrity("PAY-CAND-RACE"),"causal_contradictory/contradictory/none/5",
      "Tamper transaction must not persist");
  }
  assert.equal(value("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-CAND-RACE';"),"unverified");
  assert.equal(value("SELECT charge_total::text||'/'||available::text "+
    "FROM work_order WHERE number='OT-CAND-RACE';"),raceBefore);
  console.log("PROTOCOLIA_S2C1C4D_CAUSAL_PROJECTION_PASS "+build.target+
    " gap recovery, contradiction, rollback, unverified money");

  console.log("PROTOCOLIA_S2C1C4B_LIFECYCLE_JOURNAL_PASS "+build.target+
    " out-of-order, 10-way replay and sequence conflict, no financial mutation");

  console.log("PROTOCOLIA_S2C1C4A_UNIQUE_RECEIPT_BINDING_PASS "+build.target);

  assert.equal(value(candidate(candidateEvent,digestA,"PAY-CAND","OT-CAND","1.26")),"conflict");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate;"),"2");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox WHERE event_id="+
    literal(candidateEvent)+";"),"1");
  assert.equal(value("SELECT amount::text FROM protocolia_provider_receipt_candidate WHERE event_id="+
    literal(candidateEvent)+";"),"1.25");
  assert.equal(value("SELECT charge_total::text||'/'||available::text FROM work_order WHERE number='OT-CAND';"),before);
  assert.equal(value("SELECT provider_settlement_state FROM payment WHERE receipt='PAY-CAND';"),"unverified");
  // A rollback/retry must use an unbound receipt: second events for PAY-CAND
  // are deliberately rejected by the new one-owner invariant.
  sql("INSERT INTO work_order(number,vehicle_plate,symptom,charge_total,opening_balance,available,status) "+
    "VALUES ('OT-CAND-ROLL','CAR-CAND','Synthetic rollback proof',1.25,1.25,0,'opened');");
  sql("INSERT INTO payment(receipt,order_number,amount,method,destination_account,status,provider_settlement_state) "+
    "VALUES ('PAY-CAND-ROLL','OT-CAND-ROLL',1.25,'card','Synthetic account','posted','unverified');");
  const rollbackCandidate=candidate("evt_cand_rollback",digestA,"PAY-CAND-ROLL","OT-CAND-ROLL");
  assert.equal(value("BEGIN; "+rollbackCandidate+
    " ROLLBACK; SELECT COUNT(*) FROM protocolia_provider_receipt_candidate "+
    "WHERE event_id='evt_cand_rollback';").split("\n").at(-1),"0");
  assert.equal(value(rollbackCandidate),"stored");
  assert.equal(integrity("PAY-CAND-ROLL"),"no_lifecycle/unobserved/none/0");
  const rollObservation=(event,seq,phase)=>observation(event,seq,phase,
    "evt_cand_rollback","PAY-CAND-ROLL","OT-CAND-ROLL");
  assert.equal(value(rollObservation("evt_roll_pending_01",1,"reported_pending")),"stored");
  assert.equal(integrity("PAY-CAND-ROLL"),"synthetic_pending/coherent/reported_pending/1",
    "A coherent pending report is not a success");
  assert.equal(value(rollObservation("evt_roll_failure_02",2,"reported_failure")),"stored");
  assert.equal(integrity("PAY-CAND-ROLL"),"synthetic_failure/coherent/reported_failure/2",
    "A coherent failure report is not a success");
  assert.equal(value(rollObservation("evt_roll_failure_03",3,"reported_failure")),"stored");
  assert.equal(integrity("PAY-CAND-ROLL"),"synthetic_failure/coherent/reported_failure/3",
    "Repeated terminal failure remains a failure");
  assert.equal(value("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-CAND-ROLL';"),"unverified");
  assert.equal(value("SELECT charge_total::text||'/'||available::text FROM work_order "+
    "WHERE number='OT-CAND-ROLL';"),"1.25/0.00",
    "Read-only classification cannot alter exact financial balances");
  assert.notEqual(sql("UPDATE protocolia_provider_receipt_candidate SET amount=2.00 "+
    "WHERE event_id="+literal(candidateEvent)+";",{allowFail:true}).status,0);
  assert.notEqual(sql("DELETE FROM protocolia_provider_receipt_candidate "+
    "WHERE event_id="+literal(candidateEvent)+";",{allowFail:true}).status,0);
  assert.notEqual(sql(candidate("evt_cand_fraction",digestA,"PAY-CAND","OT-CAND","1.251"),
    {allowFail:true}).status,0);
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate;"),"3");
  // Once a candidate was committed, reversing its receipt must not turn an
  // identical provider retry into a new business decision or erase history.
  sql("BEGIN; UPDATE payment SET status='reversed' WHERE receipt='PAY-CAND'; "+
    "UPDATE work_order SET available=1.25 WHERE number='OT-CAND'; COMMIT;");
  assert.equal(value("SELECT available::text FROM work_order WHERE number='OT-CAND';"),"1.25");
  assert.equal(integrity("PAY-CAND"),"not_posted/contradictory/none/6",
    "Internal reversal overrides any earlier provider-reported phase");
  assert.equal(value(observation(sameEvent,4)),"duplicate",
    "Committed lifecycle replay survives later internal receipt reversal");
  assert.equal(value(observation("evt_life_after_reverse",7)),"mismatch",
    "New lifecycle observation cannot attach to reversed internal receipt");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox "+
    "WHERE event_id='evt_life_after_reverse';"),"0");
  assert.equal(value(candidate(candidateEvent,digestA)),"duplicate",
    "Identical committed event remains idempotent after receipt reversal");
  assert.equal(value(candidate(candidateEvent,digestB)),"conflict");
  assert.equal(value(candidate("evt_after_reverse_1234",digestA)),"mismatch",
    "New event may not attach to a reversed receipt");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_receipt_candidate;"),"3");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox WHERE "+
    "event_id='evt_after_reverse_1234';"),"0");
  assert.equal(value("SELECT provider_settlement_state FROM payment WHERE receipt='PAY-CAND';"),
    "unverified");
  // S2c-1c4j: row-level UPDATE/DELETE triggers do not intercept TRUNCATE.
  // Test as the generated database owner, not a deliberately unprivileged role.
  // Direct, multi-table and cascading truncations must all fail before removing
  // any immutable envelope, receipt binding or lifecycle evidence.
  const immutableProviderTables=[
    "protocolia_provider_envelope_inbox",
    "protocolia_provider_receipt_candidate",
    "protocolia_provider_lifecycle_observation"
  ];
  const journalCounts=immutableProviderTables.map(table=>
    value("SELECT COUNT(*) FROM "+table+";"));
  // S2c-1c4k: emulate a populated installation created BEFORE the TRUNCATE
  // hardening, then rehearse the emitted upgrade without touching V1 history.
  const upgrade=readFileSync(join(root,"protocolia-provider-journal-truncate-upgrade.sql"),"utf8");
  assert.ok(upgrade.includes("DO $protocolia_provider_upgrade$"));
  const oldGuards=immutableProviderTables.map(table=>({
    table,
    name:(table==="protocolia_provider_envelope_inbox"
      ?"protocolia_provider_envelope_immutable_guard"
      :table+"_immutable_guard")+"_truncate"
  })).map(({table,name})=>({table,name:name.slice(0,63)}));
  // PostgreSQL truncates identifiers at 63 bytes. The lifecycle guard
  // originally requested a 66-byte name; query its stored catalog name.
  const triggerCount=()=>value("SELECT COUNT(*) FROM pg_trigger t "+
    "JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname LIKE "+
    "'protocolia_provider_%' AND t.tgname IN ("+
    oldGuards.map(({name})=>literal(name)).join(",")+") AND NOT t.tgisinternal;");
  assert.equal(triggerCount(),"3");
  for(const {table,name} of oldGuards)
    sql("DROP TRIGGER "+name+" ON "+table+";");
  assert.equal(triggerCount(),"0");
  // Demonstrate the historical hole WITHOUT deleting a committed row.
  sql("BEGIN; TRUNCATE protocolia_provider_lifecycle_observation; ROLLBACK;");
  assert.deepEqual(immutableProviderTables.map(table=>
    value("SELECT COUNT(*) FROM "+table+";")),journalCounts);
  // A transaction rollback must not leave even one partially created guard.
  sql("BEGIN; "+upgrade+" ROLLBACK;");
  assert.equal(triggerCount(),"0");
  // A missing/disabled historical row-level guard is drift: fail closed.
  const drift=sql("BEGIN; ALTER TABLE protocolia_provider_receipt_candidate "+
    "DISABLE TRIGGER protocolia_provider_receipt_candidate_immutable_guard; "+
    upgrade,{allowFail:true});
  assert.notEqual(drift.status,0,"Unsafe historical guard drift must abort upgrade");
  assert.ok(drift.stderr.includes("row guard missing/drifted"));
  assert.equal(triggerCount(),"0","Failed upgrade must not partially harden schema");
  assert.equal(value("SELECT t.tgenabled FROM pg_trigger t JOIN pg_class c "+
    "ON c.oid=t.tgrelid WHERE c.relname='protocolia_provider_receipt_candidate' "+
    "AND t.tgname='protocolia_provider_receipt_candidate_immutable_guard';"),"O",
    "Drift simulation must rollback");
  // Two concurrent migration clients serialize on the advisory lock:
  // exactly three guards are created, neither client sees partial state.
  const concurrentUpgrades=await concurrent([upgrade,upgrade]);
  assert.equal(concurrentUpgrades.length,2);
  assert.equal(triggerCount(),"3");
  // A later independent application is a safe no-op.
  sql(upgrade);
  assert.equal(triggerCount(),"3");
  assert.deepEqual(immutableProviderTables.map(table=>
    value("SELECT COUNT(*) FROM "+table+";")),journalCounts);
  assert.equal(value(candidate(candidateEvent,digestA)),"duplicate");
  assert.equal(value(observation(sameEvent,4)),"duplicate");
  assert.equal(integrity("PAY-CAND-ROLL"),
    "synthetic_failure/coherent/reported_failure/3");
  assert.equal(value("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-CAND-ROLL';"),"unverified");
  console.log("PROTOCOLIA_S2C1C4K_POPULATED_JOURNAL_UPGRADE_PASS "+build.target+
    " preserved populated replay, drift rejection, rollback and repeat");

  for(const [statement,expectTrigger] of [
    // Parent tables can be blocked by FK constraints even before triggers.
    // CASCADE is required to demonstrate the trigger, not just an FK error.
    ...immutableProviderTables.map(table=>[
      "TRUNCATE TABLE "+table+";",
      table==="protocolia_provider_lifecycle_observation"
    ]),
    ...immutableProviderTables.map(table=>["TRUNCATE TABLE "+table+" CASCADE;",true]),
    ["TRUNCATE TABLE protocolia_provider_envelope_inbox, "+
      "protocolia_provider_receipt_candidate, "+
      "protocolia_provider_lifecycle_observation RESTART IDENTITY CASCADE;",true]
  ]){
    const attempt=sql(statement,{allowFail:true});
    assert.notEqual(attempt.status,0,
      "Append-only provider evidence was erased by: "+statement);
    if(expectTrigger)assert.match(attempt.stderr,/append-only/,
      "Expected the immutable trigger to reject: "+statement);
    assert.deepEqual(immutableProviderTables.map(table=>
      value("SELECT COUNT(*) FROM "+table+";")),journalCounts,
      "TRUNCATE rejection must preserve every journal row");
  }
  assert.equal(value(candidate(candidateEvent,digestA)),"duplicate",
    "Historical signed replay remains idempotent after rejected TRUNCATE");
  assert.equal(value(observation(sameEvent,4)),"duplicate",
    "Lifecycle replay remains idempotent after rejected TRUNCATE");
  assert.equal(integrity("PAY-CAND-ROLL"),
    "synthetic_failure/coherent/reported_failure/3",
    "Read-only causal history survives rejected TRUNCATE");
  assert.equal(value("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-CAND-ROLL';"),"unverified");
  console.log("PROTOCOLIA_S2C1C4J_PROVIDER_JOURNAL_TRUNCATE_GUARD_PASS "+
    build.target+" direct, cascading and multi-table TRUNCATE rejected");

  // S2c-1c4l: operator-only, opt-in runtime/migration privilege separation.
  // Exercise actual PostgreSQL role ACLs and SECURITY DEFINER entrypoints.
  const isolation=readFileSync(join(root,
    "protocolia-provider-journal-runtime-isolation.sql"),"utf8");
  assert.ok(isolation.includes("DO $protocolia_provider_runtime_acl$"));
  const runtimeRole="pia_runtime_"+randomBytes(4).toString("hex");
  const inheritedRole="pia_group_"+randomBytes(4).toString("hex");
  const ownerRole="pia_owner_"+randomBytes(4).toString("hex");
  sql("CREATE ROLE "+runtimeRole+" LOGIN; CREATE ROLE "+inheritedRole+
    "; CREATE ROLE "+ownerRole+";");
  // Never make a superuser the owner of SECURITY DEFINER entrypoints.
  // The disposable migration principal owns only the provider journal objects
  // and has read access to the receipt table required by canonical functions.
  sql("ALTER SCHEMA public OWNER TO "+ownerRole+
    "; GRANT SELECT ON payment TO "+ownerRole+
    "; GRANT UPDATE(status) ON payment TO "+ownerRole+";");
  for(const table of immutableProviderTables)
    sql("ALTER TABLE public."+table+" OWNER TO "+ownerRole+";");
  for(const signature of [
    "protocolia_provider_envelope_immutable()",
    "protocolia_record_provider_envelope_digest(text,text,text)",
    "protocolia_record_provider_receipt_candidate(text,text,text,text,text,numeric)",
    "protocolia_record_provider_lifecycle_observation(text,text,text,text,text,text,numeric,numeric,text)",
    "protocolia_provider_lifecycle_causal_projection(text)",
    "protocolia_provider_receipt_integrity_projection(text)"
  ])sql("ALTER FUNCTION public."+signature+" OWNER TO "+ownerRole+";");
  const applyAcl="BEGIN; SET ROLE "+ownerRole+
    "; SET LOCAL protocolia.provider_runtime_role="+
    literal(runtimeRole)+"; "+isolation+" COMMIT;";
  const securityDefiner=()=>value("SELECT prosecdef FROM pg_proc WHERE oid="+
    "'public.protocolia_record_provider_envelope_digest(text,text,text)'::regprocedure;");
  assert.equal(securityDefiner(),"f");
  assert.notEqual(sql(isolation,{allowFail:true}).status,0,
    "An unspecified runtime role must not trigger an ACL change");
  assert.notEqual(sql("BEGIN; SET LOCAL protocolia.provider_runtime_role='protocolia'; "+
    isolation,{allowFail:true}).status,0,
    "A superuser migration owner must never run SECURITY DEFINER isolation");
  assert.notEqual(sql("BEGIN; SET ROLE "+ownerRole+
    "; SET LOCAL protocolia.provider_runtime_role="+literal(ownerRole)+"; "+
    isolation,{allowFail:true}).status,0,
    "A runtime identity must not equal its migration owner");
  assert.equal(securityDefiner(),"f","Rejected ACL must not modify functions");
  // S2c-1c4m: the SECURITY DEFINER search_path contains public. Its owner
  // must be the trusted migration owner, not an unrelated principal that can
  // grant CREATE to an attacker after a one-time preflight.
  sql("ALTER SCHEMA public OWNER TO "+inheritedRole+";");
  const foreignSchemaOwner=sql(applyAcl,{allowFail:true});
  assert.notEqual(foreignSchemaOwner.status,0,
    "Foreign schema ownership must reject privilege elevation");
  assert.match(foreignSchemaOwner.stderr,/schema owner is not migration owner/);
  assert.equal(securityDefiner(),"f");
  sql("ALTER SCHEMA public OWNER TO "+ownerRole+";");
  // A third-party CREATE grant can shadow objects resolved by definer
  // functions even when PUBLIC and runtime themselves cannot CREATE.
  sql("GRANT CREATE ON SCHEMA public TO "+inheritedRole+";");
  const rogueSchemaCreate=sql(applyAcl,{allowFail:true});
  assert.notEqual(rogueSchemaCreate.status,0,
    "Unrelated role with CREATE in public must fail closed");
  assert.match(rogueSchemaCreate.stderr,/Public schema permits untrusted CREATE/);
  assert.equal(securityDefiner(),"f");
  sql("REVOKE CREATE ON SCHEMA public FROM "+inheritedRole+";");
  // PUBLIC CREATE is a separate unsafe case; restore before valid upgrades.
  sql("GRANT CREATE ON SCHEMA public TO PUBLIC;");
  const anonymousSchemaCreate=sql(applyAcl,{allowFail:true});
  assert.notEqual(anonymousSchemaCreate.status,0);
  // PUBLIC CREATE is inherited by the runtime itself, so the existing
  // runtime privilege guard rejects this case before the global ACL check.
  assert.match(anonymousSchemaCreate.stderr,
    /Provider runtime role has elevated or owner privileges/);
  assert.equal(securityDefiner(),"f");
  sql("REVOKE CREATE ON SCHEMA public FROM PUBLIC;");
  // A third party can inherit owner-level journal privileges even with no
  // explicit table ACL. Reject all non-superuser owner-role members.
  sql("GRANT "+ownerRole+" TO "+inheritedRole+";");
  assert.equal(value("SELECT pg_has_role("+literal(inheritedRole)+","+
    literal(ownerRole)+",'MEMBER');"),"t");
  const ownerMember=sql(applyAcl,{allowFail:true});
  assert.notEqual(ownerMember.status,0,
    "Third-party migration-owner membership must block privilege elevation");
  assert.match(ownerMember.stderr,/migration owner has untrusted role members/);
  assert.equal(securityDefiner(),"f");
  sql("REVOKE "+ownerRole+" FROM "+inheritedRole+";");
  // S2c-1c4n: direct grants to unrelated roles survive a runtime-only
  // REVOKE and can expose evidence or allow fabricated append-only rows.
  // Neither case may elevate the five SECURITY DEFINER entrypoints.
  sql("GRANT SELECT ON protocolia_provider_envelope_inbox TO "+inheritedRole+";");
  assert.equal(value("SELECT has_table_privilege("+literal(inheritedRole)+
    ",'public.protocolia_provider_envelope_inbox','SELECT');"),"t");
  const thirdPartyRead=sql(applyAcl,{allowFail:true});
  assert.notEqual(thirdPartyRead.status,0,
    "Unrelated journal reader must not survive runtime isolation");
  assert.match(thirdPartyRead.stderr,/journal has unrelated privilege grantee/);
  assert.equal(securityDefiner(),"f");
  sql("REVOKE SELECT ON protocolia_provider_envelope_inbox FROM "+inheritedRole+";");
  sql("GRANT INSERT ON protocolia_provider_receipt_candidate TO "+inheritedRole+";");
  assert.equal(value("SELECT has_table_privilege("+literal(inheritedRole)+
    ",'public.protocolia_provider_receipt_candidate','INSERT');"),"t");
  const thirdPartyWrite=sql(applyAcl,{allowFail:true});
  assert.notEqual(thirdPartyWrite.status,0,
    "Unrelated journal writer must not fabricate immutable provider evidence");
  assert.match(thirdPartyWrite.stderr,/journal has unrelated privilege grantee/);
  assert.equal(securityDefiner(),"f");
  sql("REVOKE INSERT ON protocolia_provider_receipt_candidate FROM "+inheritedRole+";");
  assert.deepEqual(immutableProviderTables.map(table=>
    value("SELECT COUNT(*) FROM "+table+";")),journalCounts,
    "Rejected ACL transitions must preserve every historical journal row");
  // A missing immutable guard must reject the entire privilege transition.
  const unsafeAcl=sql("BEGIN; ALTER TABLE protocolia_provider_envelope_inbox "+
    "DISABLE TRIGGER protocolia_provider_envelope_immutable_guard_truncate; "+
    "SET ROLE "+ownerRole+"; SET LOCAL protocolia.provider_runtime_role="+
    literal(runtimeRole)+"; "+isolation,{allowFail:true});
  assert.notEqual(unsafeAcl.status,0);
  assert.match(unsafeAcl.stderr,/TRUNCATE guard drifted/);
  assert.equal(securityDefiner(),"f");
  // Explicit rollback of a valid ACL rehearsal must leave all grants unchanged.
  sql("BEGIN; SET ROLE "+ownerRole+
    "; SET LOCAL protocolia.provider_runtime_role="+literal(runtimeRole)+
    "; "+isolation+" ROLLBACK;");
  assert.equal(securityDefiner(),"f");
  // A group with inherited journal read access is a bypass of direct REVOKE.
  // The postcondition must abort atomically, including function ALTERs.
  sql("GRANT SELECT ON protocolia_provider_envelope_inbox TO "+inheritedRole+
    "; GRANT "+inheritedRole+" TO "+runtimeRole+";");
  const inheritedAcl=sql(applyAcl,{allowFail:true});
  assert.notEqual(inheritedAcl.status,0,"Inherited journal privilege must fail closed");
  // The new all-grantees preflight rejects the group's explicit table
  // privilege before the older runtime-inheritance postcondition is reached.
  assert.match(inheritedAcl.stderr,/journal has unrelated privilege grantee/);
  assert.equal(securityDefiner(),"f");
  sql("REVOKE "+inheritedRole+" FROM "+runtimeRole+
    "; REVOKE SELECT ON protocolia_provider_envelope_inbox FROM "+inheritedRole+";");
  // An unrelated role with an explicit old EXECUTE grant must not be allowed
  // to invoke a newly elevated SECURITY DEFINER entrypoint.
  const digestSignature="public.protocolia_record_provider_envelope_digest(text,text,text)";
  sql("GRANT EXECUTE ON FUNCTION "+digestSignature+" TO "+inheritedRole+";");
  const rogueFunctionAcl=sql(applyAcl,{allowFail:true});
  assert.notEqual(rogueFunctionAcl.status,0,
    "Explicit third-party function EXECUTE grant must fail closed");
  assert.match(rogueFunctionAcl.stderr,/Unexpected provider function EXECUTE grantee/);
  assert.equal(securityDefiner(),"f");
  sql("REVOKE EXECUTE ON FUNCTION "+digestSignature+" FROM "+inheritedRole+";");
  // PUBLIC and the intended runtime may have historical direct grants:
  // the operator migration must remove both, not reject an otherwise safe
  // revocation or leave direct access after successful privilege elevation.
  sql("GRANT SELECT ON protocolia_provider_envelope_inbox TO PUBLIC; "+
    "GRANT INSERT ON protocolia_provider_lifecycle_observation TO "+runtimeRole+";");
  // Two operator sessions can race: advisory lock serializes the atomic
  // changes, and repeating a successful transition must be idempotent.
  const aclRuns=await concurrent([applyAcl,applyAcl]);
  assert.equal(aclRuns.length,2);
  sql(applyAcl);
  assert.equal(securityDefiner(),"t");
  assert.equal(value("SELECT has_table_privilege("+literal(inheritedRole)+
    ",'public.protocolia_provider_envelope_inbox','SELECT');"),"f",
    "PUBLIC journal grants must be revoked, not inherited by unrelated roles");
  for(const table of immutableProviderTables){
    assert.equal(value("SELECT has_table_privilege("+literal(runtimeRole)+
      ","+literal("public."+table)+
      ",'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');"),"f",
      "Runtime must have no direct journal access: "+table);
  }
  const asRuntime=query=>sql("SET ROLE "+runtimeRole+"; "+query)
    .stdout.trim().split("\n").at(-1);
  const deniedAsRuntime=query=>{
    const attempt=sql("SET ROLE "+runtimeRole+"; "+query,{allowFail:true});
    assert.notEqual(attempt.status,0,"Runtime unexpectedly allowed: "+query);
    assert.match(attempt.stderr,/permission denied|must be owner/,
      "Expected a real PostgreSQL permission failure");
  };
  deniedAsRuntime("SELECT * FROM protocolia_provider_envelope_inbox;");
  deniedAsRuntime("INSERT INTO protocolia_provider_envelope_inbox "+
    "(provider_id,event_id,payload_sha256) VALUES "+
    "('sandbox_provider','evt_acl_direct_01',"+literal(digestA)+");");
  deniedAsRuntime("UPDATE protocolia_provider_envelope_inbox "+
    "SET payload_sha256="+literal(digestB)+";");
  deniedAsRuntime("DELETE FROM protocolia_provider_envelope_inbox;");
  deniedAsRuntime("TRUNCATE protocolia_provider_lifecycle_observation CASCADE;");
  deniedAsRuntime("ALTER FUNCTION public.protocolia_record_provider_envelope_digest"+
    "(text,text,text) SECURITY INVOKER;");
  deniedAsRuntime("CREATE TABLE public.pia_runtime_ddl_attack (id INT);");
  assert.equal(asRuntime(call("sandbox_provider","evt_acl_valid_1234",digestA)),
    "stored","Validated SECURITY DEFINER inbox function must remain usable");
  assert.equal(asRuntime(call("sandbox_provider","evt_acl_valid_1234",digestA)),
    "duplicate","Runtime signed-event replay must remain idempotent");
  assert.equal(asRuntime(candidate(candidateEvent,digestA)),"duplicate",
    "Validated candidate entrypoint must remain callable");
  assert.equal(asRuntime(observation(sameEvent,4)),"duplicate",
    "Validated lifecycle entrypoint must remain callable");
  assert.equal(asRuntime("SELECT internal_integrity FROM "+
    "protocolia_provider_receipt_integrity_projection('PAY-CAND-ROLL');"),
    "synthetic_failure","Read-only integrity projection must remain callable");
  // Exercise first-time candidate and lifecycle writes, not only duplicates:
  // the migration owner must hold precisely the row-lock privilege needed
  // by SELECT ... FOR UPDATE on the referenced payment.
  sql("INSERT INTO work_order(number,vehicle_plate,symptom,charge_total,opening_balance,available,status) "+
    "VALUES ('OT-ACL','CAR-CAND','Runtime ACL test',1.25,1.25,0,'opened');");
  sql("INSERT INTO payment(receipt,order_number,amount,method,destination_account,status,provider_settlement_state) "+
    "VALUES ('PAY-ACL','OT-ACL',1.25,'card','Synthetic account','posted','unverified');");
  const aclCandidateEvent="evt_acl_candidate_12345678";
  const aclLifecycleEvent="evt_acl_lifecycle_12345678";
  assert.equal(asRuntime(candidate(aclCandidateEvent,digestA,
    "PAY-ACL","OT-ACL")),"stored",
    "New candidate must be inserted only through validated function");
  assert.equal(asRuntime(observation(aclLifecycleEvent,1,"reported_pending",
    aclCandidateEvent,"PAY-ACL","OT-ACL")),"stored",
    "New lifecycle must be inserted only through validated function");
  assert.equal(asRuntime(observation(aclLifecycleEvent,1,"reported_pending",
    aclCandidateEvent,"PAY-ACL","OT-ACL")),"duplicate");
  assert.deepEqual(immutableProviderTables.map(table=>
    value("SELECT COUNT(*) FROM "+table+";")),
    journalCounts.map((n,i)=>String(Number(n)+(i===0?3:1))),
    "Only three function-mediated envelopes, one candidate and one lifecycle may be added");
  assert.equal(value("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-ACL';"),"unverified");
  assert.equal(value("SELECT provider_settlement_state FROM payment "+
    "WHERE receipt='PAY-CAND-ROLL';"),"unverified");

  // S2c-1c4o: the ordinary application runtime must not be a synthetic
  // provider-event writer. This is an opt-in split, NOT provider authentication.
  const ingressRole="pia_ingress_"+randomBytes(4).toString("hex");
  sql("CREATE ROLE "+ingressRole+" LOGIN;");
  const applySplit="BEGIN; SET ROLE "+ownerRole+
    "; SET LOCAL protocolia.provider_runtime_role="+literal(runtimeRole)+
    "; SET LOCAL protocolia.provider_ingress_role="+literal(ingressRole)+
    "; "+isolation+" COMMIT;";
  const invalidSameRole=sql("BEGIN; SET ROLE "+ownerRole+
    "; SET LOCAL protocolia.provider_runtime_role="+literal(runtimeRole)+
    "; SET LOCAL protocolia.provider_ingress_role="+literal(runtimeRole)+
    "; "+isolation,{allowFail:true});
  assert.notEqual(invalidSameRole.status,0);
  assert.match(invalidSameRole.stderr,/Unsafe or identical provider ingress role/);
  sql("GRANT CREATE ON SCHEMA public TO "+ingressRole+";");
  const ingressCreate=sql(applySplit,{allowFail:true});
  assert.notEqual(ingressCreate.status,0);
  assert.match(ingressCreate.stderr,/Provider ingress role has elevated or owner privileges/);
  sql("REVOKE CREATE ON SCHEMA public FROM "+ingressRole+";");
  sql("GRANT "+ingressRole+" TO "+inheritedRole+";");
  const inheritedIngress=sql(applySplit,{allowFail:true});
  assert.notEqual(inheritedIngress.status,0);
  assert.match(inheritedIngress.stderr,/Provider ingress role has untrusted role members/);
  sql("REVOKE "+ingressRole+" FROM "+inheritedRole+";");
  const writerSignature="public.protocolia_record_provider_envelope_digest(text,text,text)";
  assert.equal(value("SELECT has_function_privilege("+literal(runtimeRole)+
    ","+literal(writerSignature)+",'EXECUTE');"),"t");
  // A transaction rehearsal may not silently revoke live runtime privileges.
  sql("BEGIN; SET ROLE "+ownerRole+
    "; SET LOCAL protocolia.provider_runtime_role="+literal(runtimeRole)+
    "; SET LOCAL protocolia.provider_ingress_role="+literal(ingressRole)+
    "; "+isolation+" ROLLBACK;");
  assert.equal(value("SELECT has_function_privilege("+literal(runtimeRole)+
    ","+literal(writerSignature)+",'EXECUTE');"),"t");
  const splitRuns=await concurrent([applySplit,applySplit]);
  assert.equal(splitRuns.length,2);
  sql(applySplit);
  assert.equal(value("SELECT has_function_privilege("+literal(runtimeRole)+
    ","+literal(writerSignature)+",'EXECUTE');"),"f");
  assert.equal(value("SELECT has_function_privilege("+literal(ingressRole)+
    ","+literal(writerSignature)+",'EXECUTE');"),"t");
  const downgrade=sql(applyAcl,{allowFail:true});
  assert.notEqual(downgrade.status,0,"Legacy reapply must never restore runtime writes");
  assert.match(downgrade.stderr,/ingress split requires explicit ingress role/);
  const deniedRuntimeWrite=sql("SET ROLE "+runtimeRole+"; "+
    call("sandbox_provider","evt_runtime_denied_12345678",digestA),{allowFail:true});
  assert.notEqual(deniedRuntimeWrite.status,0);
  assert.match(deniedRuntimeWrite.stderr,/permission denied for function/);
  assert.equal(asRuntime("SELECT internal_integrity FROM "+
    "protocolia_provider_receipt_integrity_projection('PAY-CAND-ROLL');"),
    "synthetic_failure");
  const asIngress=query=>sql("SET ROLE "+ingressRole+"; "+query)
    .stdout.trim().split("\n").at(-1);
  for(const query of [
    "SELECT * FROM protocolia_provider_envelope_inbox;",
    "SELECT * FROM protocolia_provider_receipt_integrity_projection('PAY-CAND-ROLL');"
  ]){
    const denied=sql("SET ROLE "+ingressRole+"; "+query,{allowFail:true});
    assert.notEqual(denied.status,0,"Ingress must not read journal/projections directly");
    assert.match(denied.stderr,/permission denied/);
  }
  const ingressEvent="evt_ingress_only_12345678";
  assert.equal(asIngress(call("sandbox_provider",ingressEvent,digestA)),"stored");
  assert.equal(asIngress(call("sandbox_provider",ingressEvent,digestA)),"duplicate");
  assert.equal(asIngress(call("sandbox_provider",ingressEvent,digestB)),"conflict");
  sql("INSERT INTO work_order(number,vehicle_plate,symptom,charge_total,opening_balance,available,status) "+
    "VALUES ('OT-INGRESS','CAR-CAND','Isolated ingress test',1.25,1.25,0,'opened');");
  sql("INSERT INTO payment(receipt,order_number,amount,method,destination_account,status,provider_settlement_state) "+
    "VALUES ('PAY-INGRESS','OT-INGRESS',1.25,'card','Synthetic account','posted','unverified');");
  const ingressCandidate="evt_ingress_candidate_12345678";
  const ingressLifecycle="evt_ingress_lifecycle_12345678";
  assert.equal(asIngress(candidate(ingressCandidate,digestA,"PAY-INGRESS","OT-INGRESS")),"stored");
  assert.equal(asIngress(observation(ingressLifecycle,1,"reported_pending",
    ingressCandidate,"PAY-INGRESS","OT-INGRESS")),"stored");
  assert.equal(asIngress(observation(ingressLifecycle,1,"reported_pending",
    ingressCandidate,"PAY-INGRESS","OT-INGRESS")),"duplicate");
  assert.equal(asRuntime("SELECT internal_integrity FROM "+
    "protocolia_provider_receipt_integrity_projection('PAY-INGRESS');"),
    "synthetic_pending");
  const beforeRollback=value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox;");
  sql("BEGIN; SET ROLE "+ingressRole+"; "+
    call("sandbox_provider","evt_ingress_rollback_12345678",digestA)+" ROLLBACK;");
  assert.equal(value("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox;"),beforeRollback);
  assert.equal(value("SELECT provider_settlement_state FROM payment WHERE receipt='PAY-INGRESS';"),
    "unverified");
  assert.equal(value("SELECT charge_total::text||'/'||available::text FROM work_order "+
    "WHERE number='OT-INGRESS';"),"1.25/0.00");
  console.log("PROTOCOLIA_S2C1C4O_INGRESS_RUNTIME_SPLIT_PASS "+build.target+
    " separate writer/read roles, inherited/CREATE rejection, concurrent reapply, "+
    "legacy downgrade blocked, rollback, replay and unverified money");

  console.log("PROTOCOLIA_S2C1C4N_THIRD_PARTY_JOURNAL_ACL_PASS "+build.target+
    " owner-role membership and unrelated SELECT/INSERT grants rejected, PUBLIC/runtime grants revoked, "+
    "rollback, concurrent replay and financial state preserved");
  console.log("PROTOCOLIA_S2C1C4M_TRUSTED_SCHEMA_BOUNDARY_PASS "+build.target+
    " foreign schema owner, third-party and PUBLIC CREATE rejected atomically");
  console.log("PROTOCOLIA_S2C1C4L_RUNTIME_ROLE_ISOLATION_PASS "+build.target+
    " denied direct journal DML/DDL, validated entrypoints, inherited grants, "+
    "rollback, concurrent operator upgrades and no settlement");

  console.log("PROTOCOLIA_S2C1C4I_PHASE_AWARE_SYNTHETIC_INTEGRITY_PASS "+build.target+
    " pending, success, failure, reversal, contradiction, rollback, unverified balances");
  console.log("PROTOCOLIA_S2C1C4H_RECEIPT_INTEGRITY_PASS "+build.target+
    " missing, unbound, gap, coherent synthetic-only, contradiction, reversal, no lifecycle");
  console.log("PROTOCOLIA_S2C1C3C_REVERSAL_REPLAY_PASS "+build.target);
  console.log("PROTOCOLIA_S2C1C3A_RECEIPT_CANDIDATE_PASS "+build.target+
    " exact linked candidate, 1 stored/9 duplicates, no settlement, rollback and immutable");

  console.log("PROTOCOLIA_S2C1C1_PROVIDER_INBOX_PASS "+build.target+
    " 1 stored/9 duplicates, cross-provider, digest conflict, rollback, immutable, no settlement");
}finally{
  if(started)docker(["down","-v","--remove-orphans"],{allowFail:true,timeout:120000});
  rmSync(scratch,{recursive:true,force:true});
}
