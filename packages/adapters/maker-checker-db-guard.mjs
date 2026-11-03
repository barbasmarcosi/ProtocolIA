// P2 PostgreSQL defense-in-depth for reviewed v0.5 maker-checker graphs.
// Does not protect against a privileged DBA able to drop triggers or forge
// custom session settings. Keep application DB roles narrowly provisioned.
import {auditedTransitionAuthority} from "./transition-authority.mjs";
const reject=x=>{throw Error("MAKER_GUARD_UNSAFE: "+x);};
const ensure=(v,x)=>{if(!v)reject(x);};
const ident=x=>{
 ensure(typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]{0,50}$/.test(x),"unsafe identifier");
 return x.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
};
const state=x=>{ensure(typeof x==="string"&&/^[a-z][a-z0-9_]{0,32}$/.test(x),"unsafe state");return "'"+x+"'";};
function description(ir,e){
 const ops=ir.operations.filter(x=>x.entity===e.name);
 const create=ops.find(x=>x.behavior?.kind==="create");
 const get=ops.find(x=>x.behavior?.kind==="get");
 ensure(create&&get,"missing CRUD operations");
 const policy=auditedTransitionAuthority(ir,e,get.capability,create.capability);
 if(!policy?.makerChecker)return null;
 const steps=ops.filter(x=>x.behavior?.kind==="transition");
 const submit=steps.find(x=>x.capability===policy.submit);
 const decisions=steps.filter(x=>x.capability===policy.decide);
 ensure(submit&&decisions.length===2,"unreviewed transitions");
 const field=e.fields.find(f=>f.name===submit.behavior.field);
 ensure(field&&field.type==="string"&&decisions.every(x=>x.behavior.field===field.name&&
   x.behavior.from===submit.behavior.to),"unsafe state graph");
 const table=ident(e.name),key=ident(e.publicIdentity),column=ident(field.name);
 const prefix="protocolia_mc_"+table;
 ensure(prefix.length<=58,"unsafe generated SQL function identifier");
 return {table,key,column,initial:state(field.initial),review:state(submit.behavior.to),
  terminals:decisions.map(x=>state(x.behavior.to)),
  functionName:prefix+"_guard",triggerName:prefix+"_trigger"};
}
export function checkedMakerGuardDdl(ir,e){
 const p=description(ir,e);if(!p)return [];
 const {table,column,initial,review,terminals,functionName,triggerName}=p;
 const fn=[
  "CREATE FUNCTION "+functionName+"() RETURNS trigger",
  "LANGUAGE plpgsql AS $protocolia_maker_guard$",
  "DECLARE verified_subject TEXT;",
  "BEGIN",
  "  IF TG_OP='INSERT' THEN",
  "    IF NEW."+column+" IS DISTINCT FROM "+initial+" OR",
  "       NEW.protocolia_submitted_by IS NOT NULL THEN",
  "      RAISE EXCEPTION 'Invalid maker-checker insert' USING ERRCODE='23514';",
  "    END IF;",
  "    RETURN NEW;",
  "  END IF;",
  "  IF OLD.protocolia_submitted_by IS NOT NULL AND",
  "     NEW.protocolia_submitted_by IS DISTINCT FROM OLD.protocolia_submitted_by THEN",
  "    RAISE EXCEPTION 'Maker is immutable' USING ERRCODE='23514';",
  "  END IF;",
  "  IF NEW."+column+" IS DISTINCT FROM OLD."+column+" THEN",
  "    verified_subject:=NULLIF(current_setting('protocolia.subject',true),'');",
  "    IF verified_subject IS NULL OR length(verified_subject)>128 THEN",
  "      RAISE EXCEPTION 'Missing trusted transaction subject' USING ERRCODE='23514';",
  "    END IF;",
  "    IF OLD."+column+"="+initial+" AND NEW."+column+"="+review+" AND",
  "       OLD.protocolia_submitted_by IS NULL AND",
  "       NEW.protocolia_submitted_by=verified_subject THEN",
  "      RETURN NEW;",
  "    END IF;",
  "    IF OLD."+column+"="+review+" AND NEW."+column+" IN ("+terminals.join(",")+") AND",
  "       OLD.protocolia_submitted_by IS NOT NULL AND",
  "       NEW.protocolia_submitted_by=OLD.protocolia_submitted_by AND",
  "       verified_subject<>OLD.protocolia_submitted_by THEN",
  "      RETURN NEW;",
  "    END IF;",
  "    RAISE EXCEPTION 'Invalid or self-approved maker-checker transition' USING ERRCODE='23514';",
  "  END IF;",
  "  IF NEW.protocolia_submitted_by IS DISTINCT FROM OLD.protocolia_submitted_by THEN",
  "    RAISE EXCEPTION 'Maker must be set atomically with submission' USING ERRCODE='23514';",
  "  END IF;",
  "  RETURN NEW;",
  "END;",
  "$protocolia_maker_guard$;"
 ].join("\n");
 return [
  "ALTER TABLE "+table+" ADD CONSTRAINT ck_"+table+
    "_maker_state CHECK (("+column+"="+initial+") = (protocolia_submitted_by IS NULL));",
  fn,
  "CREATE TRIGGER "+triggerName+" BEFORE INSERT OR UPDATE ON "+table+
    " FOR EACH ROW EXECUTE FUNCTION "+functionName+"();"
 ];
}
export function checkedMakerGuardProof(ir){
 if(!Array.isArray(ir.entities)||ir.entities.length!==1)return null;
 const p=description(ir,ir.entities[0]);if(!p)return null;
 // Run after HTTP conformance populated a submitted-but-pending row.
 // psql is a separate session; no transaction subject is configured there.
 return [
  "DO $protocolia_guard_test$",
  "DECLARE target TEXT; original_state TEXT;",
  "BEGIN",
  "  SELECT "+p.key+","+p.column+" INTO target,original_state FROM "+p.table,
  "    WHERE "+p.column+"="+p.review+" AND protocolia_submitted_by IS NOT NULL LIMIT 1;",
  "  IF target IS NULL THEN",
  "    RAISE EXCEPTION 'No pending maker-checker row for DB proof';",
  "  END IF;",
  "  BEGIN",
  "    UPDATE "+p.table+" SET "+p.column+"="+p.terminals[0]+" WHERE "+p.key+"=target;",
  "    RAISE EXCEPTION 'Direct terminal mutation accepted';",
  "  EXCEPTION WHEN check_violation THEN NULL;",
  "  END;",
  "  BEGIN",
  "    UPDATE "+p.table+" SET protocolia_submitted_by='forged' WHERE "+p.key+"=target;",
  "    RAISE EXCEPTION 'Maker reassignment accepted';",
  "  EXCEPTION WHEN check_violation THEN NULL;",
  "  END;",
  "  BEGIN",
  "    UPDATE "+p.table+" SET "+p.column+"="+p.initial+" WHERE "+p.key+"=target;",
  "    RAISE EXCEPTION 'State rewind accepted';",
  "  EXCEPTION WHEN check_violation THEN NULL;",
  "  END;",
  "  BEGIN",
  "    UPDATE "+p.table+" SET protocolia_submitted_by=NULL WHERE "+p.key+"=target;",
  "    RAISE EXCEPTION 'Maker erasure accepted';",
  "  EXCEPTION WHEN check_violation THEN NULL;",
  "  END;",
  "  IF (SELECT "+p.column+" FROM "+p.table+" WHERE "+p.key+"=target)<>original_state THEN",
  "    RAISE EXCEPTION 'DB proof mutated business row';",
  "  END IF;",
  "END;",
  "$protocolia_guard_test$;"
 ].join("\n");
}
