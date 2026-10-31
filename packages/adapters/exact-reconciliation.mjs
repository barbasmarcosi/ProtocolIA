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
    const chargeNames=cfg.chargeSources??(cfg.chargeSource?[cfg.chargeSource]:[]);
    const chargeFields=chargeNames.map(name=>parent?.fields.find(f=>f.name===name));
    const invalidCharge=!Array.isArray(chargeNames)||chargeNames.length>4||
      (cfg.chargeSource!==undefined&&cfg.chargeSources!==undefined)||
      (cfg.chargeSources!==undefined&&chargeNames.length<2)||
      new Set(chargeNames).size!==chargeNames.length||
      chargeNames.some(name=>!ident(name))||
      chargeFields.some(charge=>!charge||charge===opening||charge===available||
        charge.type!=="decimal"||!charge.required||charge.nullable||
        !charge.decimal||charge.decimal.min!=="0"||
        charge.decimal.scale!==b?.scale||charge.decimal.precision>b?.precision||
        charge.reference!==undefined||charge.initial!==undefined||
        charge.computedSum!==undefined||charge.computedProduct!==undefined||
        charge.computedRoundedProduct!==undefined||
        charge.computedDiscountedTotal!==undefined)||
      ir.operations.some(x=>x.entity===parent?.name&&
        (x.behavior.kind==="patchFields"&&
          [...chargeNames,cfg.openingField,cfg.availableField].includes(x.behavior.field)||
         x.behavior.kind==="patchTogether"||x.behavior.kind==="delete"));
    if(invalidCharge||cfg.serverOnly===true&&!chargeNames.length||
      cfg.serverOnly!==undefined&&typeof cfg.serverOnly!=="boolean"||
      cfg.lifecycle!==undefined&&typeof cfg.lifecycle!=="boolean"||
      cfg.lifecycle===true&&(cfg.serverOnly!==true||!chargeNames.length))
      throw Error("Invalid exact charge source "+op.name);
    if(!parent||!child||parent===child||
      ![parent.name,parent.publicIdentity,child.name,child.publicIdentity,
        ...Object.entries(cfg).filter(([k])=>k!=="serverOnly"&&k!=="chargeSources"&&k!=="lifecycle"&&k!=="adjustmentPreview"&&k!=="adjustmentJournal").map(([,v])=>v)].every(ident)||
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
    // S2c-0: one snapshot checks authoritative itemized child money AND receipts.
    const itemized=ir.operations.filter(x=>x.entity===parent.name&&
      x.behavior?.kind==="create"&&x.behavior?.createDetails?.chargeAmountField);
    const source=itemized[0]?.behavior.createDetails;
    const line=entities.get(source?.childEntity);
    const lineAmount=line?.fields.find(f=>f.name===source?.chargeAmountField);
    const lineFk=line?.fields.find(f=>f.name===source?.parentField);
    const total=parent.fields.find(f=>f.name===source?.chargeTotalField);
    if(itemized.length>1||source&&(
      itemized.length!==1||chargeNames.length!==1||
      chargeNames[0]!==source.chargeTotalField||
      !ident(source.chargeAmountField)||!ident(source.chargeTotalField)||
      source.maxRows!==20||!line||line===parent||
      !lineFk||lineFk.type!=="string"||!lineFk.reference||
      lineFk.reference.target!==parent.name||lineFk.reference.onDelete!=="restrict"||
      !lineAmount||lineAmount.type!=="decimal"||!lineAmount.decimal||
      !lineAmount.required||lineAmount.nullable||lineAmount.decimal.min!=="0"||
      !total||total.type!=="decimal"||!total.decimal||
      !total.required||total.nullable||total.decimal.min!=="0"||
      total.decimal.scale!==lineAmount.decimal.scale||
      total.decimal.precision<lineAmount.decimal.precision||
      cfg.serverOnly!==true||cfg.lifecycle!==true))
      throw Error("Invalid exact itemized source binding "+op.name);
    if(cfg.adjustmentPreview!==undefined&&cfg.adjustmentPreview!==true)
      throw Error("Invalid exact repricing preview "+op.name);
    if(cfg.adjustmentPreview===true&&(!source||
      typeof total?.decimal?.max!=="string"||
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(total.decimal.max)||
      cfg.serverOnly!==true||cfg.lifecycle!==true))
      throw Error("Invalid exact repricing preview "+op.name);
    if(cfg.adjustmentJournal!==undefined&&cfg.adjustmentJournal!==true ||
      cfg.adjustmentJournal===true&&(
        cfg.adjustmentPreview!==true||!source||!total?.decimal?.max||
        !Number.isInteger(total.decimal.precision)||
        !Number.isInteger(total.decimal.scale)||
        total.decimal.precision<1||total.decimal.precision>38||
        total.decimal.scale<0||total.decimal.scale>total.decimal.precision))
      throw Error("Invalid exact adjustment journal "+op.name);
    const journalTable=cfg.adjustmentJournal===true?
      "protocolia_exact_adjustment_"+snake(parent.name):null;
    const sourceTotal=journalTable?
      "(COALESCE(s.line_total,0)+COALESCE(a.adjustment_total,0))":
      "COALESCE(s.line_total,0)";
    const sourceGood=source?
      "(COALESCE(s.line_count,0) BETWEEN 1 AND 20 AND "+
      sourceTotal+"=p."+snake(source.chargeTotalField)+
      (journalTable?" AND COALESCE(a.adjustment_count,0) BETWEEN 0 AND 100":"")+
      " AND p."+snake(cfg.openingField)+"=p."+snake(source.chargeTotalField)+")":null;
    const sourceJoin=source?
      " LEFT JOIN LATERAL (SELECT COUNT(*) AS line_count, "+
      "SUM(d."+snake(source.chargeAmountField)+") AS line_total FROM "+
      snake(line.name)+" d WHERE d."+snake(source.parentField)+
      "=p."+snake(parent.publicIdentity)+") s ON TRUE":"";
    const journalJoin=journalTable?
      " LEFT JOIN LATERAL (SELECT COUNT(*) AS adjustment_count, "+
      "SUM(a0.delta) AS adjustment_total FROM "+journalTable+
      " a0 WHERE a0.parent_id=p."+snake(parent.publicIdentity)+") a ON TRUE":"";
    const pt=snake(parent.name),ct=snake(child.name),pk=snake(parent.publicIdentity);
    const fkCol=snake(cfg.referenceField),amountCol=snake(cfg.amountField),stateCol=snake(cfg.stateField);
    const oc=snake(cfg.openingField),bc=snake(cfg.availableField);
    const calc="(p."+oc+"-COALESCE(j.posted,0))";
    const balanced="(p."+bc+"="+calc+(sourceGood?" AND "+sourceGood:"")+")";
    const previewEligible=cfg.adjustmentPreview===true?
      "("+balanced+" AND COALESCE(s.line_count,0)<20"+
      (journalTable?" AND COALESCE(a.adjustment_count,0)<100":"")+")":null;
    const previewSql=previewEligible?
      ", "+previewEligible+" AS \"adjustmentPreviewEligible\""+
      ", CASE WHEN "+previewEligible+" THEN p."+bc+
      " ELSE (p."+bc+"-p."+bc+") END::text AS \"maxSafeDecrease\""+
      ", CASE WHEN "+previewEligible+" THEN ("+total.decimal.max+"::numeric - p."+
      snake(source.chargeTotalField)+") ELSE (p."+bc+"-p."+bc+
      ") END::text AS \"maxSafeIncrease\"":"";

    const select="SELECT p."+oc+"::text AS \"openingBalance\", p."+bc+"::text AS \"available\", "+
      "COALESCE(j.posted,0)::text AS \"postedTotal\", "+
      "COALESCE(j.reversed,0)::text AS \"reversedTotal\", "+
      calc+"::text AS \"expectedAvailable\", "+
      "(p."+bc+"-"+calc+")::text AS \"difference\", "+
      "COALESCE(j.posting_count,0)::text AS \"postingCount\", "+
      balanced+" AS \"balanced\""+previewSql+
      (cfg.lifecycle===true?
        ", CASE WHEN NOT "+balanced+" THEN 'inconsistent'"+
        " WHEN p."+oc+"=0 THEN 'no_charge'"+
        " WHEN COALESCE(j.posted,0)=0 THEN 'unpaid'"+
        " WHEN p."+bc+"=0 THEN 'covered'"+
        " ELSE 'partial' END AS \"coverageState\"":"")+
      " FROM "+pt+" p LEFT JOIN LATERAL (SELECT "+
      "SUM(CASE WHEN c."+stateCol+"='"+cfg.postedState+"' THEN c."+amountCol+" ELSE 0 END) AS posted, "+
      "SUM(CASE WHEN c."+stateCol+"='"+cfg.reversedState+"' THEN c."+amountCol+" ELSE 0 END) AS reversed, "+
      "COUNT(*) AS posting_count FROM "+ct+" c WHERE c."+fkCol+"=p."+pk+
      ") j ON TRUE"+sourceJoin+journalJoin+" WHERE p."+pk+"=";
    plans.set(op.name,{parentEntity:parent.name,sqlNest:select+"$1",sqlSpring:select+":identity",
      childReadCapability:childReader.capability,openingField:opening.name,availableField:available.name,
      chargeSources:chargeNames,
      ...(cfg.serverOnly===true?{serverOnly:true}:{}),
      ...(cfg.lifecycle===true?{lifecycle:true}:{}),
      ...(cfg.adjustmentPreview===true?{adjustmentPreview:true}:{}),
      ...(journalTable?{adjustmentJournal:{
        table:journalTable,parentTable:pt,parentColumn:pk,
        precision:total.decimal.precision,scale:total.decimal.scale,max:total.decimal.max
      }}:{})});
  }
  if(ir.operations.some(op=>op.behavior.reconcileExact&&op.behavior.kind!=="reconcileExact"))
    throw Error("Orphan exact reconciliation metadata");
  return plans;
}


// Only plans derived from checked canonical IR may provision this schema.
// Signed adjustments are an immutable journal; no client-facing write operation
// is generated in the S2c-1b0 foundation milestone.
export function exactAdjustmentJournalSql(plans){
  const journals=[...plans.values()].map(x=>x.adjustmentJournal).filter(Boolean);
  const tableSet=new Set();
  const ddl=[];
  for(const j of journals){
    if(tableSet.has(j.table))throw Error("Duplicate exact adjustment journal");
    tableSet.add(j.table);
    const safe=x=>typeof x==="string"&&/^[a-z][a-z0-9_]*$/.test(x);
    if(![j.table,j.parentTable,j.parentColumn].every(safe)||
       !Number.isInteger(j.precision)||j.precision<1||j.precision>38||
       !Number.isInteger(j.scale)||j.scale<0||j.scale>j.precision)
      throw Error("Invalid exact journal schema");
    const func="protocolia_immutable_"+j.parentTable+"_adjustment";
    ddl.push("CREATE TABLE "+j.table+" ("+
      "parent_id VARCHAR(255) NOT NULL REFERENCES "+j.parentTable+
      " ("+j.parentColumn+") ON DELETE RESTRICT, "+
      "adjustment_id VARCHAR(64) NOT NULL CHECK (length(btrim(adjustment_id)) BETWEEN 8 AND 64), "+
      "delta NUMERIC("+j.precision+","+j.scale+") NOT NULL CHECK (delta <> 0), "+
      "reason VARCHAR(240) NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 12 AND 240), "+
      "actor VARCHAR(255) NOT NULL CHECK (char_length(btrim(actor)) > 0), "+
      "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "+
      "PRIMARY KEY (parent_id, adjustment_id));");
    ddl.push("CREATE FUNCTION "+func+"() RETURNS trigger LANGUAGE plpgsql AS "+
      "$$ BEGIN RAISE EXCEPTION 'Exact adjustment journal is append-only' "+
      "USING ERRCODE = '23514'; END $$;");
    ddl.push("CREATE TRIGGER "+func+"_guard BEFORE UPDATE OR DELETE ON "+j.table+
      " FOR EACH ROW EXECUTE FUNCTION "+func+"();");
  }
  return ddl;
}
