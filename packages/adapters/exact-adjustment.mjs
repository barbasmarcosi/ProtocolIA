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
  const ids=["adjustmentId","delta","reason"];
  const id=ps&&deref(api,ps.adjustmentId);
  const delta=ps&&deref(api,ps.delta);
  const reason=ps&&deref(api,ps.reason);
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
    !endpoint||!ps||Object.keys(ps).length!==3||
    !ids.every(k=>Object.hasOwn(ps,k))||
    !ids.every(k=>model.required?.includes(k))||
    id?.type!=="string"||id.minLength!==8||id.maxLength!==64||
    reason?.type!=="string"||reason.minLength!==12||reason.maxLength!==240||
    delta?.type!=="string")
    throw Error("Invalid reviewed exact adjustment "+op?.name);
  return {parent,ledger,journal};
}
