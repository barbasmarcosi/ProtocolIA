// P2 v0.6: finite tenant-scoped state-only profile.
// Claims MUST originate from a verified JWT (or explicit demo-only test config).
// NOT a general multi-tenant authorization engine and NOT RLS.
// Never take tenant from request paths, headers, bodies, or query parameters.
const fail=why=>{throw Error("UNSAFE_TENANT_PROFILE: "+why);};
const requireValid=(v,why)=>{if(!v)fail(why);};
const safeName=x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]{0,50}$/.test(x);
const sqlName=x=>{requireValid(safeName(x),"invalid SQL identifier");return x.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();};
export const TENANT_ID_PATTERN=/^[a-z][a-z0-9_-]{1,63}$/;
export function verifiedTenantId(tenant){
 requireValid(typeof tenant==="string"&&TENANT_ID_PATTERN.test(tenant),
  "invalid or missing authenticated tenant");
 return tenant;
}
export function auditedTenantStatePolicy(ir,e){
 const ops=ir.operations.filter(op=>op.entity===e.name);
 const read=e.name.toLowerCase()+".read.tenant",write=e.name.toLowerCase()+".write.tenant";
 if(!ops.some(op=>op.capability===write||op.capability===read))return null;
 requireValid(ir.entities.length===1&&ops.length===7&&e.fields.length===3,
  "only one seven-operation state-only tenant graph");
 const counts=Object.fromEntries(["create","get","listPage","transition","health"].map(k=>
  [k,ops.filter(op=>op.behavior?.kind===k).length]));
 requireValid(counts.create===1&&counts.get===1&&counts.listPage===1&&
  counts.transition===3&&counts.health===1,"unreviewed tenant operations");
 requireValid(ops.every(op=>op.capability===(op.behavior?.kind==="get"||
   op.behavior?.kind==="listPage"?read:op.behavior?.kind==="health"?"public":write)),
   "mixed or unreviewed tenant privileges");
 const status=e.fields.find(x=>typeof x.initial==="string");
 const transitions=ops.filter(x=>x.behavior?.kind==="transition");
 requireValid(status&&transitions.every(x=>x.behavior.field===status.name&&
  Array.isArray(x.behavior.audit)&&x.behavior.audit.length===1&&
  x.behavior.audit[0]===status.name&&
  !Object.keys(x.behavior).some(k=>["reserve","release","delete","payment","moveBatch",
   "exactDebit","patchFields","createDetails"].includes(k))),
   "unsafe tenant transition");
 const root=transitions.filter(t=>t.behavior.from===status.initial);
 const forks=root.length===1?transitions.filter(t=>t.behavior.from===root[0].behavior.to):[];
 requireValid(root.length===1&&forks.length===2&&forks[0].behavior.to!==forks[1].behavior.to&&
  transitions.every(t=>t===root[0]||forks.includes(t))&&
  forks.every(t=>!transitions.some(x=>x.behavior.from===t.behavior.to)),
  "tenant state graph must have two exclusive terminal outcomes");
 requireValid(e.publicIdentity===e.fields[0].name&&
  e.fields[0].unique&&e.fields[0].required&&e.fields[0].type==="string",
  "unsafe tenant identity");
 return {entity:e.name,read,write,table:sqlName(e.name),
  identityColumn:sqlName(e.publicIdentity),stateColumn:sqlName(status.name),
  initial:status.initial};
}
export function tenantStateSchemaDdl(ir,e){
 const p=auditedTenantStatePolicy(ir,e);if(!p)return [];
 const name="protocolia_tenant_"+p.table;
 requireValid(name.length<=58,"tenant SQL name too long");
 return [
  "ALTER TABLE "+p.table+" ADD COLUMN protocolia_tenant_id VARCHAR(64) NOT NULL;",
  // Database-level immutable tenant; full DB owner could still drop the trigger.
  "CREATE FUNCTION "+name+"_guard() RETURNS trigger LANGUAGE plpgsql AS "+
  "$protocolia_tenant$ BEGIN "+
  "IF NEW.protocolia_tenant_id IS DISTINCT FROM OLD.protocolia_tenant_id THEN "+
  "RAISE EXCEPTION 'Tenant reassignment forbidden' USING ERRCODE='23514'; END IF; "+
  "RETURN NEW; END; $protocolia_tenant$;",
  "CREATE TRIGGER "+name+"_immutable BEFORE UPDATE ON "+p.table+
    " FOR EACH ROW EXECUTE FUNCTION "+name+"_guard();",
  "CREATE INDEX idx_"+p.table+"_tenant ON "+p.table+
    "(protocolia_tenant_id,"+p.identityColumn+");"
 ];
}

// Separate-session adversarial check: the internal tenant key is immutable
// even if an accidental second runtime SQL path attempts to update it.
// Does not make the database connection tenant-isolated (no RLS yet).
export function tenantStateDbProof(ir){
 if(!Array.isArray(ir.entities)||ir.entities.length!==1)return null;
 const p=auditedTenantStatePolicy(ir,ir.entities[0]);if(!p)return null;
 return [
  "DO $protocolia_tenant_proof$",
  "DECLARE id_value TEXT; org_value TEXT;",
  "BEGIN",
  "  SELECT "+p.identityColumn+",protocolia_tenant_id INTO id_value,org_value",
  "    FROM "+p.table+" LIMIT 1;",
  "  IF id_value IS NULL THEN RAISE EXCEPTION 'Missing tenant row for proof'; END IF;",
  "  BEGIN",
  "    UPDATE "+p.table+" SET protocolia_tenant_id='org_attack'",
  "      WHERE "+p.identityColumn+"=id_value;",
  "    RAISE EXCEPTION 'Tenant reassignment was accepted';",
  "  EXCEPTION WHEN check_violation THEN NULL;",
  "  END;",
  "  IF (SELECT protocolia_tenant_id FROM "+p.table+
    " WHERE "+p.identityColumn+"=id_value) IS DISTINCT FROM org_value THEN",
  "    RAISE EXCEPTION 'Tenant key drifted after denied mutation';",
  "  END IF;",
  "END;",
  "$protocolia_tenant_proof$;"
 ].join("\n");
}
