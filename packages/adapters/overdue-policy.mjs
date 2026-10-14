/**
 * A14.3/C16 stage 1: generator-agnostic persisted overdue inbox policy.
 * No background daemon, external provider or exactly-once delivery is implied.
 * Identifier inputs are compiler-validated, never interpreted as SQL expressions.
 */
const ident=v=>{
 if(typeof v!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(v))
   throw Error("Unsafe overdue identifier");
 return v;
};
const snake=x=>ident(x).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
export function compileOverduePolicies(ir){
 const rules=[];
 if(!ir||!Array.isArray(ir.entities)||!Array.isArray(ir.operations))
   throw Error("Invalid overdue canonical IR");
 for(const entity of ir.entities){
  const policy=entity.overdueAlert;
  if(!policy)continue;
  const due=entity.fields.find(f=>f.name===policy.dueField);
  const state=entity.fields.find(f=>f.name===policy.stateField);
  const recipient=entity.fields.find(f=>f.name===policy.recipientField);
  const terminal=policy.terminalState;
  if(!due||due.type!=="utcDateTime"||!state||state.type!=="string"||
     !state.required||state.nullable||!state.initial||!recipient?.reference||
     recipient.type!=="string"||!recipient.required||recipient.nullable||
     !/^[a-z][a-z0-9_-]{0,63}$/.test(terminal)||
     !ir.operations.some(op=>op.entity===entity.name&&op.behavior.kind==="transition"&&
       op.behavior.field===policy.stateField&&op.behavior.to===terminal)||
     ir.operations.some(op=>op.entity===entity.name&&op.behavior.kind==="transition"&&
       op.behavior.field===policy.stateField&&op.behavior.from===terminal)||
     policy.channel!=="inbox"||
     new Set([policy.dueField,policy.stateField,policy.recipientField]).size!==3)
    throw Error("Invalid overdue inbox rule "+entity.name);
  for(const value of [entity.name,entity.publicIdentity,policy.dueField,
    policy.stateField,policy.recipientField])ident(value);
  const key=entity.name+".overdue";
  const table=snake(entity.name);
  const fn="protocolia_materialize_"+table+"_overdue";
  if(fn.length>63)throw Error("Overdue function exceeds PostgreSQL identifier limit");
  const select="SELECT '"+key+"', '"+entity.name+"', e."+snake(entity.publicIdentity)+
    ", e."+snake(policy.recipientField)+", e."+snake(policy.dueField)+
    " FROM "+table+" e WHERE e."+snake(policy.dueField)+" IS NOT NULL "+
    "AND e."+snake(policy.dueField)+" <= as_of "+
    "AND e."+snake(policy.stateField)+" <> '"+terminal+"'";
  const ddl="CREATE OR REPLACE FUNCTION "+fn+"(as_of TIMESTAMPTZ) RETURNS INTEGER AS $pia$\n"+
    "DECLARE inserted INTEGER;\nBEGIN\n"+
    "  INSERT INTO protocolia_notification_outbox (rule_key,entity_name,resource_id,recipient_key,due_at)\n  "+
    select+"\n  ON CONFLICT (rule_key,resource_id) DO NOTHING;\n"+
    "  GET DIAGNOSTICS inserted = ROW_COUNT;\n  RETURN inserted;\nEND;\n$pia$ LANGUAGE plpgsql;";
  rules.push({key,entity:entity.name,recipientField:policy.recipientField,
    dueField:policy.dueField,stateField:policy.stateField,terminalState:terminal,
    channel:"inbox",functionName:fn,ddl});
 }
 return rules;
}
export function overdueSchemaSql(rules){
 if(!rules.length)return [];
 return [
  "CREATE TABLE protocolia_notification_outbox ("+
  "id BIGSERIAL PRIMARY KEY, "+
  "rule_key VARCHAR(128) NOT NULL, entity_name VARCHAR(128) NOT NULL, "+
  "resource_id VARCHAR(255) NOT NULL, recipient_key VARCHAR(255) NOT NULL, "+
  "due_at TIMESTAMPTZ NOT NULL, "+
  "status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','dead')), "+
  "attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0), "+
  "available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "+
  "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "+
  "delivered_at TIMESTAMPTZ, last_error TEXT, "+
  "UNIQUE(rule_key,resource_id));",
  "CREATE INDEX idx_protocolia_notification_claim "+
    "ON protocolia_notification_outbox (available_at,id) WHERE status='pending';",
  ...rules.map(rule=>rule.ddl)
 ];
}
