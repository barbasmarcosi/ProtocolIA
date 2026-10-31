// S2c-1b1: portable fail-closed preflight for authorized signed money writes.
// Runtime SQL names come ONLY from the checked reconciliation plans.
const ident=x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(x);
const deref=(api,x)=>x?.$ref?x.$ref.split("/").slice(1).reduce((v,k)=>v?.[k],api):x;
export function assertExactAdjustment(ir,api,op,plans){
  const parent=ir.entities.find(e=>e.name===op?.entity);
  const rec=ir.operations.filter(x=>x.entity===parent?.name&&x.behavior.kind==="reconcileExact");
  const create=ir.operations.filter(x=>x.entity===parent?.name&&x.behavior.kind==="create");
  const get=ir.operations.filter(x=>x.entity===parent?.name&&x.behavior.kind==="get");
  const audit=ir.operations.filter(x=>x.entity===parent?.name&&x.behavior.kind==="auditPage");
  const adjustmentOps=ir.operations.filter(x=>x.entity===parent?.name&&x.behavior.kind==="adjustExact");
  const ledger=rec.length===1?plans.get(rec[0].name):null;
  const journal=ledger?.adjustmentJournal;
  const charge=parent?.fields.find(f=>f.name===ledger?.chargeSources?.[0]);
  const path=parent&&"/{"+parent.publicIdentity+"}/adjustments";
  const endpoint=api?.paths?.[op?.path]?.post;
  const rb=deref(api,endpoint?.requestBody);
  const model=deref(api,rb?.content?.["application/json"]?.schema);
  const ps=model?.properties;
  const ids=["adjustmentId","delta","reason","expectedOpening","expectedAvailable","expectedPostingCount","expectedReversedTotal","expectedAdjustmentCount"];
  const id=ps&&deref(api,ps.adjustmentId);
  const delta=ps&&deref(api,ps.delta);
  const reason=ps&&deref(api,ps.reason);
  const expectedMoney=["expectedOpening","expectedAvailable","expectedReversedTotal"];
  const expectedCounts=["expectedPostingCount","expectedAdjustmentCount"];
  if(!parent||!ident(parent.publicIdentity)||!journal||
    !journal.table?.startsWith("protocolia_exact_adjustment_")||
    typeof journal.max!=="string"||!charge?.decimal||charge.decimal.max!==journal.max||
    rec[0].behavior.reconcileExact.adjustmentJournal!==true||
    adjustmentOps.length!==1||create.length!==1||get.length!==1||audit.length>1||
    !op||op.method!=="POST"||op.behavior.kind!=="adjustExact"||
    !op.path.endsWith(path)||[...op.path.matchAll(/\{([^}]+)\}/g)].length!==1||
    ![201,400,401,403,404,409].every(code=>op.statuses?.includes(code))||
    !op.capability||op.capability==="public"||
    [create[0].capability,get[0].capability,audit[0]?.capability].includes(op.capability)||
    op.behavior.audit!==undefined||op.behavior.field!==undefined||op.behavior.input!==undefined||
    !endpoint||!ps||Object.keys(ps).length!==8||
    !ids.every(k=>Object.hasOwn(ps,k))||
    !ids.every(k=>model.required?.includes(k))||
    id?.type!=="string"||id.minLength!==8||id.maxLength!==64||
    reason?.type!=="string"||reason.minLength!==12||reason.maxLength!==240||
    delta?.type!=="string"||
    !expectedMoney.every(name=>deref(api,ps[name])?.type==="string")||
    !expectedCounts.every(name=>deref(api,ps[name])?.type==="string"))
    throw Error("Invalid reviewed exact adjustment "+op?.name);
  return {parent,ledger,journal};
}


// An actual authorization check happens in each HTTP adapter. The stored
// function serializes the parent and rechecks the entire exact money graph
// in a NEW READ COMMITTED statement before altering any money.
const snake=x=>x.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
export function exactAdjustmentWriteSql(ir,plans){
  const adjusting=ir.operations.filter(x=>x.behavior.kind==="adjustExact");
  const tables=new Set(),ddl=[];
  for(const op of adjusting){
    const parent=ir.entities.find(e=>e.name===op.entity);
    const rec=ir.operations.find(x=>x.entity===parent?.name&&x.behavior.kind==="reconcileExact");
    const plan=rec&&plans.get(rec.name);
    const journal=plan?.adjustmentJournal;
    if(!journal||!parent||!ident(parent.name)||!ident(op.name)||tables.has(journal.table))
      throw Error("Invalid adjustment SQL target "+op.name);
    tables.add(journal.table);
    const table=journal.parentTable,pk=journal.parentColumn,
      opening=snake(plan.openingField),available=snake(plan.availableField),
      source=snake(plan.chargeSources[0]),
      func="protocolia_apply_exact_adjustment_"+table;
    const select=plan.sqlNest.replace(/\$1$/,"v_parent");
    if(!select.endsWith("WHERE p."+pk+"=v_parent")||
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(source)||
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(opening)||
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(available)||
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(journal.max))
      throw Error("Invalid signed adjustment SQL plan "+op.name);
    ddl.push("CREATE FUNCTION "+func+
      "(v_parent VARCHAR,v_id VARCHAR,v_delta NUMERIC,v_reason VARCHAR,v_actor VARCHAR,v_expected_open NUMERIC,v_expected_available NUMERIC,v_expected_posting BIGINT,v_expected_reversed NUMERIC,v_expected_adjustments BIGINT) "+
      "RETURNS VOID LANGUAGE plpgsql AS $pia_adjust$ DECLARE "+
      "v_balanced BOOLEAN;v_eligible BOOLEAN;v_review_open NUMERIC;v_review_available NUMERIC;"+
      "v_review_posting BIGINT;v_review_reversed NUMERIC;v_review_adjustments BIGINT;v_charge NUMERIC;"+
      "v_opening NUMERIC;v_available NUMERIC;v_new_charge NUMERIC;"+
      "v_new_opening NUMERIC;v_new_available NUMERIC; BEGIN "+
      "PERFORM 1 FROM "+table+" WHERE "+pk+"=v_parent FOR UPDATE; "+
      "IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment parent not found' USING ERRCODE='P0002'; END IF; "+
      "SELECT q.\"balanced\",q.\"adjustmentPreviewEligible\",q.\"openingBalance\"::NUMERIC,"+
      "q.\"available\"::NUMERIC,q.\"postingCount\"::BIGINT,q.\"reversedTotal\"::NUMERIC,"+
      "q.\"adjustmentCount\"::BIGINT INTO v_balanced,v_eligible,v_review_open,"+
      "v_review_available,v_review_posting,v_review_reversed,v_review_adjustments FROM ("+
      select+") q; "+
      "IF NOT COALESCE(v_balanced,false) OR NOT COALESCE(v_eligible,false) THEN "+
      "RAISE EXCEPTION 'Exact adjustment ledger conflict' USING ERRCODE='PZ409'; END IF; "+
      "IF v_expected_open IS NULL OR v_expected_available IS NULL OR "+
      "v_expected_posting IS NULL OR v_expected_reversed IS NULL OR "+
      "v_expected_adjustments IS NULL OR "+
      "v_review_open<>v_expected_open OR v_review_available<>v_expected_available OR "+
      "v_review_posting<>v_expected_posting OR v_review_reversed<>v_expected_reversed OR "+
      "v_review_adjustments<>v_expected_adjustments THEN "+
      "RAISE EXCEPTION 'Reviewed ledger snapshot changed' USING ERRCODE='PZ409'; END IF; "+
      "IF v_id IS NULL OR char_length(btrim(v_id)) NOT BETWEEN 8 AND 64 OR "+
      "v_reason IS NULL OR char_length(btrim(v_reason)) NOT BETWEEN 12 AND 240 OR "+
      "v_actor IS NULL OR char_length(btrim(v_actor))=0 OR "+
      "v_delta IS NULL OR v_delta=0 OR "+
      "v_delta<>ROUND(v_delta,"+journal.scale+") THEN "+
      "RAISE EXCEPTION 'Invalid exact adjustment request' USING ERRCODE='23514'; END IF; "+
      "SELECT "+source+","+opening+","+available+
      " INTO v_charge,v_opening,v_available FROM "+table+" WHERE "+pk+"=v_parent; "+
      "v_new_charge:=v_charge+v_delta; v_new_opening:=v_opening+v_delta; "+
      "v_new_available:=v_available+v_delta; "+
      "IF v_new_charge<0 OR v_new_charge>"+journal.max+"::NUMERIC OR "+
      "v_new_opening<0 OR v_new_opening>"+journal.max+"::NUMERIC OR "+
      "v_new_available<0 OR v_new_available>"+journal.max+"::NUMERIC THEN "+
      "RAISE EXCEPTION 'Adjustment exceeds permitted balance' USING ERRCODE='PZ409'; END IF; "+
      "INSERT INTO "+journal.table+
      " (parent_id,adjustment_id,delta,reason,actor) "+
      "VALUES (v_parent,v_id,v_delta,v_reason,v_actor); "+
      "UPDATE "+table+" SET "+source+"=v_new_charge,"+
      opening+"=v_new_opening,"+available+"=v_new_available WHERE "+pk+"=v_parent; "+
      "INSERT INTO protocolia_audit_event "+
      "(actor,entity_name,resource_id,operation_name,field_name,before_value,after_value) "+
      "VALUES (v_actor,'"+parent.name+"',v_parent,'"+op.name+"','"+
      plan.chargeSources[0]+"',v_charge::TEXT,v_new_charge::TEXT),"+
      "(v_actor,'"+parent.name+"',v_parent,'"+op.name+"','"+
      plan.openingField+"',v_opening::TEXT,v_new_opening::TEXT),"+
      "(v_actor,'"+parent.name+"',v_parent,'"+op.name+"','"+
      plan.availableField+"',v_available::TEXT,v_new_available::TEXT),"+
      "(v_actor,'"+parent.name+"',v_parent,'"+op.name+
      "','adjustmentId',NULL,v_id); END $pia_adjust$;");
  }
  return ddl;
}
