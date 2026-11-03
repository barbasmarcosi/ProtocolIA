// Reviewed transition-only authority plan shared by NestJS and Spring generators.
// No implicit delegation: existing contracts keep their entity write capability.
// This opt-in plan accepts exactly one audited initial->review->two-terminals DAG,
// with namespaced submit and decide capabilities derived from the entity name.
// It is NOT record-level separation of duties or authenticated owner approval.
const reject=why=>{throw Error("UNSAFE_TRANSITION_AUTHORITY: "+why);};
const insist=(condition,why)=>{if(!condition)reject(why);};
export function auditedTransitionAuthority(ir,entity,read,write){
 const operations=ir.operations.filter(op=>op.entity===entity.name);
 const transitions=operations.filter(op=>op.behavior?.kind==="transition");
 if(transitions.length===0||transitions.every(op=>op.capability===write))return null;
 insist(ir.entities.length===1,"special authority requires exactly one entity");
 insist(operations.length===7&&transitions.length===3,"only seven-operation review graph supported");
 const kinds=operations.map(op=>op.behavior?.kind).sort();
 insist(JSON.stringify(kinds)===JSON.stringify(["create","get","health","listPage","transition","transition","transition"].sort()),
  "unexpected operation in review graph");
 const fields=new Set(transitions.map(op=>op.behavior.field));
 insist(fields.size===1,"review graph must operate on one state field");
 const field=entity.fields.find(f=>f.name===[...fields][0]);
 insist(field&&typeof field.initial==="string"&&
  field.type==="string"&&field.required===true&&!field.nullable&&
  /^[a-z][a-z0-9_]{0,32}$/.test(field.initial),"missing safe initial state");
 const auditOnly=op=>op.method==="POST"&&
  op.behavior.kind==="transition"&&
  Array.isArray(op.behavior.audit)&&
  op.behavior.audit.length===1&&op.behavior.audit[0]===field.name&&
  !["reserve","release","createDetails","moveUnits","moveBatch","debitExact","reverseExact",
   "reverseBatch","reverseUnits","reassignReference","patchFields","delete","reconcileExact"]
   .some(k=>op.behavior[k]!==undefined);
 insist(transitions.every(auditOnly),"unaudited or effectful state operation");
 const start=transitions.filter(op=>op.behavior.from===field.initial);
 insist(start.length===1,"exactly one initial submit transition required");
 const forks=transitions.filter(op=>op.behavior.from===start[0].behavior.to);
 insist(forks.length===2&&forks.every(op=>op!==start[0]&&
   op.behavior.to!==field.initial&&op.behavior.to!==start[0].behavior.to)&&
   forks[0].behavior.to!==forks[1].behavior.to,
   "exactly two exclusive terminal decisions required");
 insist(!transitions.some(op=>forks.some(t=>t.behavior.to===op.behavior.from)),
  "terminal transitions must have no outgoing path");
 const prefix=entity.name.toLowerCase();
 const submit=prefix+".submit",decide=prefix+".decide";
 insist([read,write,submit,decide].every(x=>typeof x==="string"&&
    /^[a-z][a-z0-9.]{2,70}$/.test(x)&&x!=="public")&&
   new Set([read,write,submit,decide]).size===4,
   "invalid or overlapping read/write/submit/decide capabilities");
 insist(start[0].capability===submit&&forks.every(t=>t.capability===decide),
  "unreviewed or escalated per-transition capability");
 return {submit,decide,allowed:new Map([[start[0].name,submit],
   ...forks.map(x=>[x.name,decide])])};
}
