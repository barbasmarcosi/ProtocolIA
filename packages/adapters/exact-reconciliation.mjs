// B2.5c: one PostgreSQL MVCC snapshot of an exact, reversible debit ledger.
// All SQL identifiers and states must be sourced from validated canonical IR.
import {compileExactDebits,compileExactReversals} from "./exact-debit.mjs";
const ident=x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(x);
const stateValue=x=>typeof x==="string"&&/^[a-z][a-z0-9_-]{0,63}$/.test(x);
const snake=x=>x.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
export function compileExactReconciliations(ir){
  const entities=new Map(ir.entities.map(e=>[e.name,e]));
  const debits=compileExactDebits(ir),reversals=compileExactReversals(ir),plans=new Map();
  const of=(kind,entity)=>ir.operations.filter(op=>op.entity===entity&&op.behavior.kind===kind);
  for(const op of ir.operations){
    const cfg=op.behavior?.reconcileExact;
    if(!cfg)continue;
    const parent=entities.get(op.entity),child=entities.get(cfg.childEntity);
    const opening=parent?.fields.find(f=>f.name===cfg.openingField);
    const available=parent?.fields.find(f=>f.name===cfg.availableField);
    const fk=child?.fields.find(f=>f.name===cfg.referenceField);
    const amount=child?.fields.find(f=>f.name===cfg.amountField);
    const state=child?.fields.find(f=>f.name===cfg.stateField);
    const original=of("create",child?.name).filter(x=>x.behavior.debitExact&&
      x.behavior.debitExact.stockEntity===parent?.name&&
      x.behavior.debitExact.availableField===cfg.availableField&&
      x.behavior.debitExact.referenceField===cfg.referenceField&&
      x.behavior.debitExact.quantityField===cfg.amountField);
    const reversal=of("transition",child?.name).filter(x=>x.behavior.reverseExact&&
      x.behavior.reverseExact.stockEntity===parent?.name&&
      x.behavior.reverseExact.availableField===cfg.availableField&&
      x.behavior.reverseExact.referenceField===cfg.referenceField&&
      x.behavior.reverseExact.quantityField===cfg.amountField&&
      x.behavior.field===cfg.stateField&&x.behavior.from===cfg.postedState&&
      x.behavior.to===cfg.reversedState);
    const parentReader=of("get",parent?.name)[0],childReader=of("get",child?.name)[0];
    const writes=ir.operations.filter(x=>
      x.behavior.kind==="patchFields"&&
      ((x.entity===parent?.name&&[cfg.openingField,cfg.availableField].includes(x.behavior.field))||
       (x.entity===child?.name&&[cfg.referenceField,cfg.amountField,cfg.stateField].includes(x.behavior.field)))||
      x.entity===child?.name&&["delete","reassignReference"].includes(x.behavior.kind));
    const b=available?.decimal,o=opening?.decimal,c=amount?.decimal;
    if(!parent||!child||parent===child||
      ![parent.name,parent.publicIdentity,child.name,child.publicIdentity,...Object.values(cfg)].every(ident)||
      !stateValue(cfg.postedState)||!stateValue(cfg.reversedState)||cfg.postedState===cfg.reversedState||
      op.behavior.kind!=="reconcileExact"||op.method!=="GET"||
      ![200,401,403,404].every(code=>op.statuses?.includes(code))||
      op.path.split("{").length!==2||!op.path.includes("{"+parent.publicIdentity+"}")||
      op.behavior.reserve||op.behavior.release||op.behavior.debitExact||op.behavior.reverseExact||
      op.behavior.audit||op.behavior.input||op.behavior.field||op.behavior.from||op.behavior.to||
      !opening||!available||opening===available||opening.type!=="decimal"||available.type!=="decimal"||
      !opening.required||opening.nullable||!available.required||available.nullable||
      !o||!b||o.min!=="0"||b.min!=="0"||o.scale!==b.scale||o.precision!==b.precision||
      o.max!==b.max||!fk?.reference||fk.reference.target!==parent.name||!fk.required||fk.nullable||
      amount?.type!=="decimal"||!amount.required||amount.nullable||!c||c.scale!==b.scale||
      state?.initial!==cfg.postedState||state?.type!=="string"||!state.required||state.nullable||
      !parentReader||!childReader||op.capability!==parentReader.capability||
      childReader.capability==="public"||original.length!==1||reversal.length!==1||
      !debits.has(original[0]?.name)||!reversals.has(reversal[0]?.name)||
      of("reconcileExact",parent.name).length!==1||writes.length>0)
      throw Error("Invalid exact ledger reconciliation "+op.name);
    const pt=snake(parent.name),ct=snake(child.name),pk=snake(parent.publicIdentity);
    const fkCol=snake(cfg.referenceField),amountCol=snake(cfg.amountField),stateCol=snake(cfg.stateField);
    const oc=snake(cfg.openingField),bc=snake(cfg.availableField);
    const calc="(p."+oc+"-COALESCE(j.posted,0))";
    const select="SELECT p."+oc+"::text AS \"openingBalance\", p."+bc+"::text AS \"available\", "+
      "COALESCE(j.posted,0)::text AS \"postedTotal\", "+
      "COALESCE(j.reversed,0)::text AS \"reversedTotal\", "+
      calc+"::text AS \"expectedAvailable\", "+
      "(p."+bc+"-"+calc+")::text AS \"difference\", "+
      "COALESCE(j.posting_count,0)::text AS \"postingCount\", "+
      "(p."+bc+"="+calc+") AS \"balanced\""+
      " FROM "+pt+" p LEFT JOIN LATERAL (SELECT "+
      "SUM(CASE WHEN c."+stateCol+"='"+cfg.postedState+"' THEN c."+amountCol+" ELSE 0 END) AS posted, "+
      "SUM(CASE WHEN c."+stateCol+"='"+cfg.reversedState+"' THEN c."+amountCol+" ELSE 0 END) AS reversed, "+
      "COUNT(*) AS posting_count FROM "+ct+" c WHERE c."+fkCol+"=p."+pk+
      ") j ON TRUE WHERE p."+pk+"=";
    plans.set(op.name,{sqlNest:select+"$1",sqlSpring:select+":identity",
      childReadCapability:childReader.capability,openingField:opening.name,availableField:available.name});
  }
  if(ir.operations.some(op=>op.behavior.reconcileExact&&op.behavior.kind!=="reconcileExact"))
    throw Error("Orphan exact reconciliation metadata");
  return plans;
}
