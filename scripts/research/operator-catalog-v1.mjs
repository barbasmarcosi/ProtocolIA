// P2 — operator catalog v1: immutable *reviewed* semantic primitives.
// A pin or fingerprint proves version/integrity, not authenticated owner consent.
// Adding a descriptor here must undergo independent compiler/runtime conformance;
// unrecognized external descriptors NEVER become executable automatically.
import {createHash} from "node:crypto";
const fail=why=>{throw Error("OPERATOR_ASSEMBLY_INVALID: "+why);};
const requireValid=(ok,why)=>{if(!ok)fail(why);};
const plain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const exact=(x,keys,label)=>requireValid(plain(x)&&Object.keys(x).length===keys.length&&
 Object.keys(x).every(k=>keys.includes(k)),label+" has unexpected/missing fields");
const name=x=>typeof x==="string"&&/^[a-z][A-Za-z0-9]{2,50}$/.test(x);
const state=x=>typeof x==="string"&&/^[a-z][a-z0-9_]{1,32}$/.test(x);
const routeSuffix=x=>typeof x==="string"&&/^[a-z][a-z0-9-]{1,25}$/.test(x);
const manifest=Object.freeze([
 Object.freeze({
  id:"capacity.reserve",version:1,kind:"reserve",decorator:"reserve",
  trigger:"create-journal",transaction:"atomic-decrement-and-insert",
  invariants:["nonnegative-availability","unique-journal-key","foreign-key-restrict"],
  conformance:["PROTOCOLIA_ATOMIC_DEBIT_RACE_PASS"]
 }),
 Object.freeze({
  id:"state.transition-audited",version:1,kind:"transition",decorator:"transition",
  trigger:"conditional-state-change",transaction:"compare-and-set",
  invariants:["reachable-dag","no-state-joins","single-winner","audited-state"],
  conformance:["PROTOCOLIA_STATEFUL_CONFORMANCE_PASS"]
 }),
 Object.freeze({
  id:"capacity.release-terminal",version:1,kind:"release",decorator:"release",
  trigger:"terminal-state-change",transaction:"credit-once-and-transition",
  invariants:["exactly-one-release","terminal-state","no-double-credit"],
  conformance:["PROTOCOLIA_COMPENSATING_CONFORMANCE_PASS"]
 })
]);
export const OPERATOR_VERSIONS=Object.freeze({
 reserve:"capacity.reserve@1",
 transition:"state.transition-audited@1",
 release:"capacity.release-terminal@1"
});
const serialize=x=>JSON.stringify(x);
const sha=x=>createHash("sha256").update(serialize(x)).digest("hex");
export function operatorCatalogSnapshot(){
 const operators=structuredClone(manifest);
 return {schemaVersion:"protocolia-operator-catalog/v1",operators};
}
export function operatorCatalogDigest(){return sha(operatorCatalogSnapshot());}
export function requireOperatorVersions(pins){
 exact(pins,["reserve","transition","release"],"operator version pins");
 for(const [k,v]of Object.entries(OPERATOR_VERSIONS))
  requireValid(pins[k]===v,"unknown, unreviewed or downgraded operator version: "+k);
 return {pins:{...OPERATOR_VERSIONS},catalogSha256:operatorCatalogDigest()};
}
// Catalog comparison is advisory ONLY, not permission to execute added code.
// An addition requires a reviewed new grammar version and real conformance.
// Any changed or removed existing semantic descriptor is a breaking change.
export function classifyOperatorCatalogChange(previous,next){
 function parsed(snapshot){
  exact(snapshot,["schemaVersion","operators"],"catalog snapshot");
  requireValid(snapshot.schemaVersion==="protocolia-operator-catalog/v1"&&
   Array.isArray(snapshot.operators)&&snapshot.operators.length<=64,
   "unsupported catalog snapshot");
  const ids=new Set();
  for(const desc of snapshot.operators){
   exact(desc,["id","version","kind","decorator","trigger","transaction","invariants","conformance"],
    "catalog descriptor");
   requireValid(typeof desc.id==="string"&&/^[a-z][a-z0-9.-]{2,64}$/.test(desc.id)&&
    Number.isSafeInteger(desc.version)&&desc.version>0&&
    ["reserve","transition","release"].includes(desc.kind)&&
    typeof desc.decorator==="string"&&typeof desc.trigger==="string"&&
    typeof desc.transaction==="string"&&
    Array.isArray(desc.invariants)&&desc.invariants.every(v=>typeof v==="string")&&
    Array.isArray(desc.conformance)&&desc.conformance.every(v=>typeof v==="string"),
    "malformed catalog descriptor");
   requireValid(!ids.has(desc.id),"duplicate catalog descriptor");
   ids.add(desc.id);
  }
  return new Map(snapshot.operators.map(x=>[x.id,x]));
 }
 const old=parsed(previous),updated=parsed(next);
 const removed=[],changed=[],added=[];
 for(const [id,entry] of old){
  if(!updated.has(id))removed.push(id);
  else if(serialize(entry)!==serialize(updated.get(id)))changed.push(id);
 }
 for(const id of updated.keys())if(!old.has(id))added.push(id);
 return {classification:removed.length||changed.length?"breaking":
  added.length?"requires-review":"identical",
  removed:removed.sort(),changed:changed.sort(),added:added.sort(),
  executable:false};
}
// Independently testable reserve operator policy, reused by grammar and its tests.
export function validateReservePrimitive(reserve,parent,child){
 exact(reserve,["kind","journal","parent"],"reserve operator");
 requireValid(reserve.kind==="reserve"&&reserve.journal===child&&reserve.parent===parent,
  "reserve edge mismatch");
 return true;
}
// Independently testable transition + conditional release semantics. Ordered
// evaluation is for validation only: it does not decide the execution order.
export function validateTerminalTransitionPrimitives(transitions,initial){
 requireValid(Array.isArray(transitions)&&transitions.length>=2&&transitions.length<=4,
  "transition count unsupported");
 requireValid(state(initial),"invalid initial state");
 const names=new Set(),suffixes=new Set(),destinations=new Set();
 let releases=0;
 for(const t of transitions){
  exact(t,["kind","name","suffix","from","to","release"],"transition operator");
  requireValid(t.kind==="transition"&&name(t.name)&&routeSuffix(t.suffix)&&
   state(t.from)&&state(t.to)&&t.from!==t.to&&typeof t.release==="boolean",
   "unsafe transition");
  requireValid(!names.has(t.name)&&!suffixes.has(t.suffix),"duplicate transition");
  requireValid(!destinations.has(t.to),"ambiguous transition destination");
  names.add(t.name);suffixes.add(t.suffix);destinations.add(t.to);
  if(t.release)releases++;
 }
 requireValid(releases===1,"exactly one compensating release transition required");
 const reachable=new Set([initial]),remaining=[...transitions];
 while(remaining.length){
  const allowed=remaining.filter(t=>reachable.has(t.from)&&!reachable.has(t.to));
  requireValid(allowed.length>0,"unreachable or cyclic transition graph");
  for(const t of allowed){reachable.add(t.to);remaining.splice(remaining.indexOf(t),1);}
 }
 const released=transitions.find(t=>t.release);
 requireValid(!transitions.some(t=>t.from===released.to),"compensation must be terminal");
 const terminal=transitions.filter(t=>!transitions.some(x=>x.from===t.to));
 requireValid(terminal.length>=2,"need two terminal outcomes");
 requireValid(terminal.some(t=>!t.release),"need a non-compensated outcome");
 return {terminalCount:terminal.length,releaseName:released.name,
  states:[...reachable].sort()};
}
