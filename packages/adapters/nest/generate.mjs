import {compileRecipientInboxes,recipientInboxSql,assertInboxOpenApi} from "../recipient-inbox.mjs";
import {createHash} from "node:crypto";
import {buildQueryPlan,assertQueryOpenApi} from "../query-plan.mjs";
import {compileOverduePolicies,overdueSchemaSql} from "../overdue-policy.mjs";
import {assertDecimalField,assertComputedProduct,assertComputedRoundedProduct,assertComputedDiscountedTotal,decimalSql,assertDecimalWireSchema} from "../exact-decimal.mjs";
import {compileRelatedSums} from "../related-sum.mjs";
import {compileDetailSums} from "../detail-sum.mjs";
import {compileExactDebits,compileExactReversals} from "../exact-debit.mjs";
import {compileExactReconciliations} from "../exact-reconciliation.mjs";
import {compileOwnerScopes} from "../owner-scope.mjs";
import {uniqueTogetherSql} from "../composite-uniqueness.mjs";
import {assertMoveUnits,assertReverseUnits} from "../stock-transfer.mjs";
import {assertMoveBatch,assertReverseBatch} from "../multi-leg-transfer.mjs";
import {assertCreateDetails} from "../create-details.mjs";
import {assertPatchTogether} from "../compound-patch.mjs";
import {uniqueWhenSql} from "../conditional-uniqueness.mjs";
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync,readdirSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const uiRoot=resolve(root,"../modular/templates/web");
const safe=x=>{if(typeof x!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(x))throw Error("Unsafe identifier "+x);return x;};
const snake=x=>safe(x).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
const deref=(s,p)=>p?.$ref?p.$ref.split("/").slice(1).reduce((o,k)=>o?.[k],s):p;
function numberSchema(spec,op,query){
  const endpoint=spec.paths?.[op.path]?.[op.method.toLowerCase()];
  let field;
  if(query){
    const param=endpoint?.parameters?.map(p=>deref(spec,p)).find(p=>p.name===query&&p.in==="query");
    field=deref(spec,param?.schema);
  }else{
    const body=deref(spec,endpoint?.requestBody);
    const model=deref(spec,body?.content?.["application/json"]?.schema);
    field=deref(spec,model?.properties?.[op.behavior.input]);
  }
  if(!field||!Number.isInteger(field.minimum)||!Number.isInteger(field.maximum)||
     (query&&!Number.isInteger(field.default)))throw Error("Unresolved bounds "+op.name+" "+query);
  return field;
}
export function generate(ir,spec,out){
  if(ir?.irVersion!=="vnext-a0.1"||!Array.isArray(ir.entities)||
    ir.entities.length<1||ir.entities.length>8||!Array.isArray(ir.operations))
    throw Error("Unsupported canonical contract IR for NestJS");
  if(existsSync(out)&&readdirSync(out).length)throw Error("Output not empty; refusing overwrite");
  const YEAR_MONTH_PATTERN="^[0-9]{4}-(0[1-9]|1[0-2])$";
  const entities=new Map(),tables=new Set(),reads=[],writes=[],audits=[],assignments=[],compiled=[];
  for(const e of ir.entities){
    safe(e.name);safe(e.publicIdentity);
    if(entities.has(e.name)||tables.has(snake(e.name)))throw Error("Duplicate entity/table");
    uniqueTogetherSql(e); // Reject unsupported business rule before generation.
    uniqueWhenSql(e,ir.operations); // Check partial-key lifecycle before generation.
    entities.set(e.name,e);tables.add(snake(e.name));
    if(!e.fields.some(f=>f.name===e.publicIdentity&&f.type==="string"&&f.unique&&f.required&&!f.nullable))
      throw Error("Public identity must be required unique string");
    const columns=new Set();
    for(const f of e.fields){
      safe(f.name);
      if(columns.has(snake(f.name)))throw Error("Duplicate SQL column");
      columns.add(snake(f.name));
      if(!["string","int32","utcDateTime","decimal"].includes(f.type))throw Error("Unsupported field type");
      assertDecimalField(f,e.name+"."+f.name);
      assertComputedProduct(f,e);
      assertComputedRoundedProduct(f,e);
      assertComputedDiscountedTotal(f,e);
      if(f.greaterThanField!==undefined){
        const source=e.fields.find(x=>x.name===f.greaterThanField);
        if(!source||source===f||!source.required||source.nullable||
           source.greaterThanField||source.computedSum||source.reference||
           !((source.type==="int32"&&f.type==="int32")||
             (source.type==="decimal"&&f.type==="decimal"&&source.decimal&&f.decimal))||
           f.nullable||f.unique||f.reference||f.computedSum||
           f.initial!==undefined||f.requiredWhen)
          throw Error("Unsupported typed numeric comparison "+e.name+"."+f.name);
      }
      if(f.afterField!==undefined){
        const source=e.fields.find(x=>x.name===f.afterField);
        if(!source||source===f||source.type!=="utcDateTime"||!source.required||source.nullable||
           source.afterField||f.type!=="utcDateTime"||f.nullable||f.reference||f.computedSum||
           f.initial||f.requiredWhen||f.decimal||f.unique)
          throw Error("Unsupported temporal rule "+e.name+"."+f.name);
      }
      if(f.computedSum!==undefined && (f.type!=="int32"||f.name===e.publicIdentity||!f.required||f.nullable||
        !Array.isArray(f.computedSum)||f.computedSum.length<2||f.computedSum.length>8||
        new Set(f.computedSum).size!==f.computedSum.length||
        f.computedSum.some(n=>{const s=e.fields.find(x=>x.name===n);return !s||s===f||s.type!=="int32"||
          !s.required||s.nullable||s.computedSum||s.min===undefined||s.min<0||!Number.isInteger(s.max);})||
        e.fields.filter(x=>f.computedSum.includes(x.name)).reduce((n,x)=>n+x.max,0)>2147483647))
        throw Error("Invalid computedSum "+e.name+"."+f.name);
      if(f.initial!==undefined && (f.type!=="string"||!f.required||f.nullable||f.unique||
        f.reference||typeof f.initial!=="string"||!/^[a-z][a-z0-9_-]{0,63}$/.test(f.initial)||
        f.initial.length<(f.minLength??1)||f.initial.length>(f.maxLength??255)))
        throw Error("Invalid finite-state initial value "+e.name+"."+f.name);
      if(f.choices!==undefined&&(f.type!=="string"||f.reference||f.unique||
        !Array.isArray(f.choices)||f.choices.length<2||f.choices.length>16||
        new Set(f.choices.map(c=>c.value)).size!==f.choices.length||
        f.choices.some(c=>typeof c.value!=="string"||!/^[a-z][a-z0-9_-]{0,63}$/.test(c.value))))
        throw Error("Unsupported enum choices "+e.name+"."+f.name);
      if(f.forbidWhen){
        const source=e.fields.find(x=>x.name===f.forbidWhen.field);
        if(f.type!=="string"||f.required||f.nullable||f.unique||f.reference||
          f.initial!==undefined||f.computedSum||!source||source===f||
          source.type!=="string"||source.nullable||source.initial!==undefined||
          !source.choices?.some(x=>x.value===f.forbidWhen.equals)||
          (f.requiredWhen?.field===source.name&&f.requiredWhen.equals===f.forbidWhen.equals))
          throw Error("Invalid forbidden combination "+e.name+"."+f.name);
      }
      if(f.requiredWhen){
        const source=e.fields.find(x=>x.name===f.requiredWhen.field);
        if(f.type!=="string"||f.required||f.nullable||f.unique||
          f.initial!==undefined||f.reference||f.computedSum||f.choices||
          !source||source===f||source.type!=="string"||source.nullable||
          source.initial!==undefined||!source.choices?.some(x=>x.value===f.requiredWhen.equals))
          throw Error("Invalid conditional requirement "+e.name+"."+f.name);
      }
      if(f.pattern!==undefined&&(f.pattern!==YEAR_MONTH_PATTERN||f.type!=="string"||
         f.minLength!==7||f.maxLength!==7))throw Error("Unsupported domain pattern "+e.name+"."+f.name);
      if(f.type==="string"&&(!Number.isInteger(f.maxLength??255)||(f.maxLength??255)<1))
        throw Error("Invalid string maximum length");
    }
  }
  for(const e of ir.entities)for(const f of e.fields)if(f.reference){
    const target=entities.get(f.reference.target);
    const targetField=target?.fields.find(x=>x.name===target.publicIdentity);
    if(!target||target===e||!targetField||targetField.type!=="string"||f.type!=="string"||
      f.reference.onDelete!=="restrict"||!f.required||f.nullable||
      (f.maxLength??255)<(targetField.maxLength??255))
      throw Error("Unsupported FK: "+e.name+"."+f.name);
  }
  const inboxes=compileRecipientInboxes(ir);
  const relatedSums=compileRelatedSums(ir);
  const detailSums=compileDetailSums(ir);
  const exactDebits=compileExactDebits(ir);
  const exactReversals=compileExactReversals(ir);
  const exactReconciliations=compileExactReconciliations(ir);
  const ownerScopes=compileOwnerScopes(ir);
  const fieldReadCapabilities=[...new Set(ir.entities.flatMap(e=>e.fields.map(f=>f.readCapability).filter(Boolean)))];
  for(const op of ir.operations)assertInboxOpenApi(spec,op);
  const methods={create:"POST",get:"GET",listPage:"GET",queryPage:"GET",auditPage:"GET",inboxPage:"GET",ackNotification:"POST",patchFields:"PATCH",patchTogether:"PATCH",
    atomicIncrement:"PATCH",transition:"POST",reassignReference:"PATCH",sumRelated:"GET",sumDetails:"GET",reconcileExact:"GET",replaceDetails:"PUT",delete:"DELETE",health:"GET"};
  const ok={create:201,get:200,listPage:200,queryPage:200,auditPage:200,inboxPage:200,ackNotification:200,patchFields:200,patchTogether:200,
    atomicIncrement:200,transition:200,reassignReference:200,sumRelated:200,sumDetails:200,reconcileExact:200,replaceDetails:200,delete:204,health:200};
  const routeKeys=new Set(),of=(kind,entity)=>ir.operations.filter(o=>
    o.behavior?.kind===kind&&(!entity||o.entity===entity));
  if(of("health").length!==1)throw Error("One health operation required");
  for(const e of ir.entities){
    for(const kind of ["create","get","listPage"])
      if(of(kind,e.name).length!==1)throw Error("Missing "+kind+" on "+e.name);
    for(const kind of ["patchTogether","atomicIncrement","auditPage","queryPage","reassignReference","replaceDetails","delete"])
      if(of(kind,e.name).length>1)throw Error("Duplicate "+kind+" on "+e.name);
    const edits=of("patchFields",e.name);
    const associated=ir.operations.some(op=>op.behavior.createDetails?.childEntity===e.name);
    if(edits.length>1&&(!associated||edits.length>3||
      new Set(edits.map(op=>op.behavior.field)).size!==edits.length||
      edits.some(op=>op.behavior.audit?.length!==1)))
      throw Error("Only distinct audited child fields support multiple PATCH operations");
    const read=of("get",e.name)[0].capability,write=of("create",e.name)[0].capability;
    if(!read||!write||read===write||read==="public"||write==="public")
      throw Error("Invalid read/write capabilities");
    if(!reads.includes(read))reads.push(read);
    if(!writes.includes(write))writes.push(write);
    const auditRead=of("auditPage",e.name)[0];
    if(auditRead){
      if(auditRead.capability==="public"||auditRead.capability===read||auditRead.capability===write||
         !ir.operations.some(x=>x.entity===e.name&&x.behavior.audit?.length))
        throw Error("Audit reader requires own capability and source events");
      if(!audits.includes(auditRead.capability))audits.push(auditRead.capability);
    }
    for(const op of of("reassignReference",e.name)){
      if(op.capability==="public"||op.capability===read||op.capability===write||op.capability===auditRead?.capability)
        throw Error("Reference reassignment needs independent capability");
      if(!assignments.includes(op.capability))assignments.push(op.capability);
    }
    for(const op of ir.operations.filter(o=>o.entity===e.name)){
      const b=op.behavior,kind=b?.kind;
      if(!methods[kind]||op.method!==methods[kind]||!op.statuses?.includes(ok[kind]))
        throw Error("Verb/status mismatch "+op.name);
      if(kind==="patchTogether")assertPatchTogether(e,op);
      if(kind==="patchFields"&&e.uniqueTogether?.includes(b.field)){
        const f=e.fields.find(x=>x.name===b.field);
        if(!f||f.type!=="string"||!f.required||f.nullable||f.reference||
           f.ownerManaged||f.initial!==undefined||b.input!==f.name||
           ![400,404,409].every(status=>op.statuses.includes(status)))
          throw Error("Unsafe compound-key PATCH "+op.name);
      }
      const cap=kind==="health"?"public":
        ["create","patchFields","patchTogether","atomicIncrement","transition","replaceDetails","delete"].includes(kind)?write:read;
      const ownerPatch=kind==="patchFields"&&e.fields.some(field=>field.ownerManaged);
      if(ownerPatch){
        if(!op.capability||op.capability==="public"||op.capability===read||op.capability===write)
          throw Error("Owner field patch must use independent field write capability "+op.name);
        if(!writes.includes(op.capability))writes.push(op.capability);
      }
      if(!ownerPatch&&kind==="patchFields"&&associated&&b.audit?.length===1){
        if(!op.capability||op.capability==="public"||op.capability===read||
          op.capability===auditRead?.capability)throw Error("Unsafe detail editor capability "+op.name);
        if(!writes.includes(op.capability))writes.push(op.capability);
      }else if(!ownerPatch&&kind!=="auditPage"&&kind!=="reassignReference"&&kind!=="inboxPage"&&kind!=="ackNotification"&&op.capability!==cap)throw Error("Wrong capability "+op.name);
      if(!/^\/[A-Za-z0-9_/{}/-]+$/.test(op.path)||routeKeys.has(op.method+" "+op.path))
        throw Error("Duplicate/invalid route "+op.name);
      routeKeys.add(op.method+" "+op.path);
      const tokens=[...op.path.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(x=>x[1]);
      const keyed=["get","auditPage","patchFields","patchTogether","atomicIncrement","transition","reassignReference","sumRelated","sumDetails","reconcileExact","replaceDetails","delete"].includes(kind);
      if(keyed?(tokens.length!==1||tokens[0]!==e.publicIdentity):tokens.length>0&&kind!=="ackNotification")
        throw Error("Public identity mismatch "+op.name);
      if(kind==="queryPage"){buildQueryPlan(ir,op);assertQueryOpenApi(spec,op);}
      if(kind==="auditPage"&&(b.audit||b.reserve||b.release||b.field||b.input||
         !op.statuses.includes(400)||!op.statuses.includes(404)))
        throw Error("Invalid read-only auditPage metadata "+op.name);
      if(b.audit){
        const fields=b.audit;
        if(!Array.isArray(fields)||fields.length===0||fields.length>8||
           new Set(fields).size!==fields.length||!["create","transition","reassignReference","patchFields"].includes(kind)&&
           !(kind==="delete"&&ir.operations.some(x=>x.behavior.createDetails?.versioned&&
             x.behavior.createDetails.childEntity===e.name&&
             fields.includes(x.behavior.createDetails.parentField)))||
           fields.some(x=>!e.fields.some(f=>f.name===x))||
           (["transition","reassignReference","patchFields"].includes(kind)&&(fields.length!==1||fields[0]!==b.field))||
           (["create","delete"].includes(kind)&&fields.includes(e.publicIdentity)))
          throw Error("Invalid audited operation "+op.name);
      }
      if(b.moveUnits)assertMoveUnits(ir,e,op);
      if(b.moveBatch)assertMoveBatch(ir,e,op);
      if(b.createDetails)assertCreateDetails(ir,e,op);
      if(b.reverseBatch)assertReverseBatch(ir,e,op);
      if(b.reverseUnits)assertReverseUnits(ir,e,op);
      if(b.reserve){
        const stock=entities.get(b.reserve.stockEntity);
        const available=stock?.fields.find(f=>f.name===b.reserve.availableField);
        const relation=e.fields.find(f=>f.name===b.reserve.referenceField);
        const amount=e.fields.find(f=>f.name===b.reserve.quantityField);
        if(kind!=="create"||!stock||stock===e||!available||
           available.type!=="int32"||!available.required||available.nullable||
           (available.min??-1)<0||!relation||relation.type!=="string"||
           !relation.required||relation.nullable||relation.reference?.target!==stock.name||
           !amount||amount.type!=="int32"||!amount.required||amount.nullable||
           (amount.min??-1)<1||!op.statuses?.includes(400)||!op.statuses?.includes(409))
          throw Error("Invalid atomic reserve "+op.name);
      }
      if(b.release){
        const r=b.release,stock=entities.get(r.stockEntity);
        const available=stock?.fields.find(f=>f.name===r.availableField);
        const relation=e.fields.find(f=>f.name===r.referenceField);
        const amount=e.fields.find(f=>f.name===r.quantityField);
        const state=e.fields.find(f=>f.name===b.field);
        const matching=of("create",e.name).filter(x=>x.behavior.reserve &&
          Object.keys(r).every(k=>x.behavior.reserve[k]===r[k]));
        if(kind!=="transition"||!state?.initial||b.from!==state.initial||
           !stock||stock===e||!available||available.type!=="int32"||!available.required||
           available.nullable||(available.min??-1)<0||!relation||relation.type!=="string"||
           !relation.required||relation.nullable||relation.reference?.target!==stock.name||
           !amount||amount.type!=="int32"||!amount.required||amount.nullable||
           (amount.min??-1)<1||matching.length!==1||
           ir.operations.some(x=>x.entity===e.name&&x.behavior.kind==="transition"&&
             x.behavior.field===state.name&&x.behavior.from===b.to))
          throw Error("Invalid exactly-once release "+op.name);
      }
      if(kind==="reassignReference"){
        const relation=e.fields.find(f=>f.name===b.field);
        if(!relation?.reference||relation.type!=="string"||!relation.required||
           relation.nullable||relation.initial!==undefined||b.input!==relation.name||
           !b.audit||b.audit.length!==1||b.audit[0]!==relation.name||
           ![400,404,409].every(status=>op.statuses.includes(status))||
           b.reserve||b.release||b.from||b.to)
          throw Error("Invalid guarded reference reassignment "+op.name);
      }
      if(kind==="transition"){
        const field=e.fields.find(f=>f.name===b.field);
        const safe=x=>typeof x==="string" && /^[a-z][a-z0-9_-]{0,63}$/.test(x) &&
          x.length>=(field?.minLength??1) && x.length<=(field?.maxLength??255);
        if(!field||!field.initial||field.type!=="string"||!field.required||field.nullable||
          !safe(b.from)||!safe(b.to)||b.from===b.to||b.input||!op.statuses?.includes(409))
          throw Error("Invalid source-guarded transition "+op.name);
      }
      if(["patchFields","atomicIncrement"].includes(kind)){
        const field=e.fields.find(f=>f.name===b.field);
        if(!field||!b.input||
           (kind==="patchFields"&&(field.nullable||field.initial!==undefined||
             field.computedSum||b.input!==b.field||
             (field.type!=="string"&&!(field.type==="int32"&&b.audit?.length===1&&
               (field.min??0)>=1&&(field.max??2147483647)<=1000000000))))||
           (kind==="atomicIncrement"&&field.type!=="int32"))
          throw Error("Unsupported mutation "+op.name);
      }
      const item={name:op.name,method:op.method,path:op.path,entity:e.name,
        kind,capability:op.capability,...(b.audit?{audit:b.audit}:{}),...(b.field?{field:b.field}:{}),
        ...(b.input?{input:b.input}:{}),...(kind==="transition"?{from:b.from,to:b.to}:{})};
      if(b.reverseUnits){
        const plan=assertReverseUnits(ir,e,op);
        item.reverseUnits={
          stockTable:snake(plan.stock.name),
          stockKeyColumn:snake(plan.stock.publicIdentity),
          availableColumn:snake(plan.available.name),
          sourceColumn:snake(plan.source.name),
          targetColumn:snake(plan.target.name),
          amountColumn:snake(plan.amount.name),
          maxBalance:plan.available.max??2147483647,
          parentWriteCapability:plan.parentWriteCapability
        };
      }
      if(b.reverseBatch){
        const plan=assertReverseBatch(ir,e,op);
        item.reverseBatch={
          stockTable:snake(plan.stock.name),
          stockKeyColumn:snake(plan.stock.publicIdentity),
          availableColumn:snake(plan.available.name),
          maxBalance:plan.available.max??2147483647,
          parentWriteCapability:plan.parentWriteCapability,
          legs:plan.legs.map(leg=>({
            sourceField:snake(leg.sourceField),
            targetField:snake(leg.targetField),
            quantityField:snake(leg.quantityField)
          }))
        };
      }
      if(b.createDetails){
        const plan=assertCreateDetails(ir,e,op);
        item.createDetails={
          versioned:b.createDetails.versioned===true,
          ...(b.createDetails.closeField?{closeField:b.createDetails.closeField,
            closeState:b.createDetails.closeState}:{}),
          childEntity:plan.child.name,
          parentField:plan.relation.name,
          rowsField:plan.rowsField,
          maxRows:plan.maxRows,
          childWriteCapability:plan.childWriteCapability
        };
      }
      if(b.moveBatch){
        const plan=assertMoveBatch(ir,e,op);
        item.moveBatch={
          stockTable:snake(plan.stock.name),
          stockKeyColumn:snake(plan.stock.publicIdentity),
          availableColumn:snake(plan.available.name),
          maxBalance:plan.available.max??2147483647,
          parentWriteCapability:plan.parentWriteCapability,
          legs:plan.legs
        };
      }
      if(b.moveUnits){
        const plan=assertMoveUnits(ir,e,op);
        item.moveUnits={
          stockTable:snake(plan.stock.name),stockKeyColumn:snake(plan.stock.publicIdentity),
          availableColumn:snake(plan.available.name),
          sourceField:b.moveUnits.sourceField,targetField:b.moveUnits.targetField,
          quantityField:b.moveUnits.quantityField,
          maxBalance:plan.available.max??2147483647,
          parentWriteCapability:plan.parentWriteCapability
        };
      }
      if(b.reserve){
        const stock=entities.get(b.reserve.stockEntity);
        const stockCreate=of("create",stock.name)[0];
        if(!stockCreate||stockCreate.capability==="public")throw Error("Missing stock writer capability");
        item.reserve={
          stockTable:snake(stock.name),stockKeyColumn:snake(stock.publicIdentity),
          availableColumn:snake(b.reserve.availableField),referenceField:b.reserve.referenceField,
          quantityField:b.reserve.quantityField,stockWriteCapability:stockCreate.capability
        };
      }
      if(b.debitExact)item.exactDebit=exactDebits.get(op.name);
      if(b.reverseExact)item.exactReverse=exactReversals.get(op.name);
      if(b.release){
        const stock=entities.get(b.release.stockEntity);
        const write=of("create",stock.name)[0];
        if(!write||write.capability==="public")throw Error("Missing stock writer capability");
        item.release={
          stockTable:snake(stock.name),stockKeyColumn:snake(stock.publicIdentity),
          availableColumn:snake(b.release.availableField),
          referenceColumn:snake(b.release.referenceField),amountColumn:snake(b.release.quantityField),
          stockWriteCapability:write.capability
        };
      }
      if(["listPage","queryPage","auditPage","inboxPage"].includes(kind)){
        const l=numberSchema(spec,op,"limit"),o=numberSchema(spec,op,"offset");
        Object.assign(item,{limitMin:l.minimum,limitMax:l.maximum,limitDefault:l.default,
          offsetDefault:o.default,offsetMax:o.maximum});
      }
      if(kind==="queryPage")item.query=buildQueryPlan(ir,op);
      if(kind==="sumRelated")item.relatedSum=relatedSums.get(op.name);
      if(kind==="sumDetails")item.detailSum=detailSums.get(op.name);
      if(kind==="reconcileExact")item.exactReconciliation=exactReconciliations.get(op.name);
      if(kind==="atomicIncrement"){
        const n=numberSchema(spec,op);
        Object.assign(item,{inputMin:n.minimum,inputMax:n.maximum});
      }
      compiled.push(item);
    }
  }
  reads.push(...new Set(inboxes.map(r=>r.readCapability)));
  assignments.push(...new Set(inboxes.map(r=>r.ackCapability)));
  if(reads.some(x=>writes.includes(x))||audits.some(x=>reads.includes(x)||writes.includes(x))||assignments.some(x=>reads.includes(x)||writes.includes(x)||audits.includes(x)))throw Error("Ambiguous read/write/audit authority");
  const contents=[];
  const write=(p,t)=>{
    const full=join(out,p);mkdirSync(dirname(full),{recursive:true});
    writeFileSync(full,t);contents.push(p);
  };
  const copy=(p,source)=>{
    const full=join(out,p);mkdirSync(dirname(full),{recursive:true});
    copyFileSync(source,full);contents.push(p);
  };
  for(const op of ir.operations.filter(o=>o.behavior.kind==="create"))
    assertDecimalWireSchema(spec,op,ir.entities.find(e=>e.name===op.entity));
  const overdueRules=compileOverduePolicies(ir);
  const schema=[];
  for(const e of ir.entities){
    const fields=e.fields.map(f=>{
      const col=snake(f.name),sqlType=f.type==="string"?"VARCHAR("+(f.maxLength??255)+")":
        f.type==="int32"?"INTEGER":f.type==="decimal"?decimalSql(f,col).type:"TIMESTAMP WITH TIME ZONE";
      const checks=[f.name===e.publicIdentity?"PRIMARY KEY":"",
        f.required&&!f.nullable?"NOT NULL":"",
        f.unique&&f.name!==e.publicIdentity?"UNIQUE":"",
        f.type==="string"&&f.minLength!==undefined?"CHECK (char_length("+col+") >= "+f.minLength+")":"",
        f.type==="string"&&f.required&&!f.nullable?"CHECK (char_length(btrim("+col+")) > 0)":"",
        f.pattern!==undefined?"CHECK ("+col+" ~ '"+YEAR_MONTH_PATTERN+"')":"",
        f.choices?.length?"CHECK ("+col+" IN ("+f.choices.map(c=>"'"+c.value+"'").join(",")+"))":"",
        f.min!==undefined?"CHECK ("+col+">="+f.min+")":"",
        f.max!==undefined?"CHECK ("+col+"<="+f.max+")":"",
        ...(f.type==="decimal"?decimalSql(f,col).checks:[])].filter(Boolean);
      if(f.initial!==undefined){
        const states=new Set([f.initial,...ir.operations.filter(op=>
          op.entity===e.name&&op.behavior.kind==="transition"&&op.behavior.field===f.name)
          .flatMap(op=>[op.behavior.from,op.behavior.to])]);
        if(states.size<2||[...states].some(v=>typeof v!=="string"||!/^[a-z][a-z0-9_-]{0,63}$/.test(v)))
          throw Error("Invalid finite-state transition values");
        checks.push("CHECK ("+col+" IN ("+[...states].sort().map(v=>"'"+v+"'").join(",")+"))");
      }
      const generated=f.computedSum?" GENERATED ALWAYS AS ("+f.computedSum.map(snake).join(" + ")+") STORED":
        f.computedProduct?" GENERATED ALWAYS AS ("+f.computedProduct.map(snake).join(" * ")+") STORED":
        f.computedRoundedProduct?" GENERATED ALWAYS AS (round("+
          snake(f.computedRoundedProduct.left)+" * "+snake(f.computedRoundedProduct.right)+
          ", "+f.decimal.scale+")) STORED":
        f.computedDiscountedTotal?" GENERATED ALWAYS AS (round(("+
          snake(f.computedDiscountedTotal.price)+" * "+snake(f.computedDiscountedTotal.quantity)+
          " * (100 - "+snake(f.computedDiscountedTotal.discount)+")) / 100, "+
          f.decimal.scale+")) STORED":"";
      return "  "+col+" "+sqlType+generated+" "+checks.join(" ");
    });
    const conditional=e.fields.filter(f=>f.requiredWhen).map(f=>{
      const col=snake(f.name),source=snake(f.requiredWhen.field);
      return "  CONSTRAINT ck_cond_"+snake(e.name)+"_"+col+" CHECK ("+
        source+" IS DISTINCT FROM '"+f.requiredWhen.equals+"' OR "+
        "("+col+" IS NOT NULL AND char_length(btrim("+col+")) > 0))";
    });
    const forbidden=e.fields.filter(f=>f.forbidWhen).map(f=>{
      const col=snake(f.name),source=snake(f.forbidWhen.field);
      return "  CONSTRAINT ck_forbid_"+snake(e.name)+"_"+col+" CHECK ("+
        source+" IS DISTINCT FROM '"+f.forbidWhen.equals+"' OR "+col+" IS NULL)";
    });
    const chronological=e.fields.filter(f=>f.afterField!==undefined).map(f=>{
      const col=snake(f.name),source=snake(f.afterField);
      return "  CONSTRAINT ck_order_"+snake(e.name)+"_"+col+" CHECK ("+
        col+" IS NULL OR "+col+" > "+source+")";
    });
    const compared=e.fields.filter(f=>f.greaterThanField!==undefined).map(f=>{
      const col=snake(f.name),source=snake(f.greaterThanField);
      return "  CONSTRAINT ck_gt_"+snake(e.name)+"_"+col+" CHECK ("+
        col+" IS NULL OR "+col+" > "+source+")";
    });
    const versioned=ir.operations.some(op=>op.entity===e.name&&op.behavior.createDetails?.versioned);
    schema.push("CREATE TABLE "+snake(e.name)+" (\n"+[...fields,...(versioned?["  document_version INTEGER NOT NULL DEFAULT 1 CHECK (document_version >= 1)"]:[]),...conditional,...forbidden,...chronological,...compared,...uniqueTogetherSql(e)].join(",\n")+"\n);");
  }
  for(const e of ir.entities)schema.push(...uniqueWhenSql(e,ir.operations));
  for(const e of ir.entities)for(const f of e.fields)if(f.reference){
    const parent=entities.get(f.reference.target);
    schema.push("ALTER TABLE "+snake(e.name)+" ADD CONSTRAINT fk_"+snake(e.name)+"_"+
      snake(f.name)+" FOREIGN KEY ("+snake(f.name)+") REFERENCES "+
      snake(parent.name)+" ("+snake(parent.publicIdentity)+") ON DELETE RESTRICT;");
  }
  const queryIndexDdl=new Set();
  for(const op of ir.operations.filter(op=>op.behavior.kind==="queryPage"))
    for(const ddl of buildQueryPlan(ir,op).ddl)queryIndexDdl.add(ddl);
  schema.push(...queryIndexDdl);
  schema.push(...overdueSchemaSql(overdueRules));
  if(ir.operations.some(op=>op.behavior.audit))schema.push(
    "CREATE TABLE protocolia_audit_event (id BIGSERIAL PRIMARY KEY, "+
    "actor VARCHAR(255) NOT NULL, entity_name VARCHAR(128) NOT NULL, "+
    "resource_id VARCHAR(255) NOT NULL, operation_name VARCHAR(128) NOT NULL, "+
    "field_name VARCHAR(128) NOT NULL, before_value TEXT, after_value TEXT, "+
    "occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);",
    "CREATE INDEX idx_protocolia_audit_resource ON protocolia_audit_event (entity_name,resource_id,id);");
  schema.push(...recipientInboxSql(inboxes));
  const manifest={entities:ir.entities.map(e=>({name:e.name,table:snake(e.name),
    publicIdentity:e.publicIdentity,identityColumn:snake(e.publicIdentity),
    ...(ownerScopes.get(e.name)?.relation?{ownerRelation:ownerScopes.get(e.name).relation}:{}),
    fields:e.fields.map(f=>({...f,column:snake(f.name)}))})),
    operations:compiled,readCapabilities:reads,writeCapabilities:writes,auditCapabilities:audits,assignmentCapabilities:assignments,
    fieldReadCapabilities,
    hasOverdueRules:overdueRules.length>0};
  write("src/manifest.json",JSON.stringify(manifest,null,2)+"\n");
  write("src/schema.sql",schema.join("\n")+"\n");
  if(overdueRules.length)write("protocolia-overdue-rules.json",JSON.stringify(
    overdueRules.map(({ddl,...policy})=>policy),null,2)+"\n");
  mkdirSync(join(out,"src/migrations"),{recursive:true});
  copy("src/main.ts",join(root,"templates/main.ts"));
  copy("src/BffSession.ts",join(root,"templates/BffSession.ts"));
  copy("src/BffKeyring.ts",join(root,"templates/BffKeyring.ts"));
  write("package.json",JSON.stringify({name:"protocolia-nest-generated",
    private:true,version:"0.0.1",
    scripts:{build:"tsc -p tsconfig.json",start:"node dist/main.js"},
    dependencies:{"@nestjs/common":"11.1.6","@nestjs/core":"11.1.6",
      "@nestjs/platform-express":"11.1.6","pg":"8.16.3","jose":"5.10.0",
      "reflect-metadata":"0.2.2","rxjs":"7.8.2"},
    devDependencies:{"typescript":"5.9.3","@types/node":"24.3.0","@types/pg":"8.15.5"}
  },null,2)+"\n");
  write("tsconfig.json",JSON.stringify({compilerOptions:{target:"ES2022",
    module:"CommonJS",moduleResolution:"Node",outDir:"dist",rootDir:"src",
    strict:false,esModuleInterop:true,experimentalDecorators:true,
    emitDecoratorMetadata:true,resolveJsonModule:true,skipLibCheck:true},
    include:["src/**/*.ts"]},null,2)+"\n");
  for(const f of ["package.json","index.html","src/main.jsx","src/App.jsx","src/OAuthPkce.js","src/AuthSession.js","src/PagedReferencePicker.jsx","src/NotificationInbox.jsx","src/style.css"])
    copy("web/"+f,join(uiRoot,f));
  write("web/vite.config.mjs",'import {defineConfig} from "vite";\n'+
    'export default defineConfig({base:"/",build:{outDir:"../dist/static",emptyOutDir:false}});\n');
  const resources=ir.entities.map(entity=>({entity,view:entity.view??entity.name,
    transitions:ir.operations.filter(op=>op.entity===entity.name&&op.behavior.kind==="transition")
      .map(op=>({name:op.name,method:op.method,path:op.path,capability:op.capability,behavior:op.behavior})),
    patchFieldsOptions:ir.operations.filter(op=>op.entity===entity.name&&op.behavior.kind==="patchFields")
      .map(op=>({name:op.name,method:op.method,path:op.path,capability:op.capability,behavior:op.behavior})),
    operations:Object.fromEntries(ir.operations.filter(op=>
      op.entity===entity.name&&op.behavior.kind!=="health"&&op.behavior.kind!=="transition").map(op=>[
        op.behavior.kind,{method:op.method,path:op.path,capability:op.capability,behavior:op.behavior}
      ]))}));
  write("dist/static/protocolia-ui.json",JSON.stringify({...resources[0],resources},null,2)+"\n");
  write("Dockerfile",[
    "FROM node:24-bookworm-slim","WORKDIR /app",
    "COPY package*.json ./","RUN npm ci --omit=dev",
    "COPY dist ./dist","COPY src/schema.sql ./src/schema.sql",
    "COPY src/migrations ./src/migrations",
    "EXPOSE 8080",'CMD ["node","dist/main.js"]',""
  ].join("\n"));
  write(".dockerignore","node_modules/\nweb/\n.protocolia-toolchain/\n.env\n");
  write(".env.example",[
    "PROTOCOLIA_DB_PASSWORD=","PROTOCOLIA_AUTH_MODE=demo",
    "# Use jwt for verified Bearer resource-server APIs (demo and jwt are mutually exclusive).",
    "PROTOCOLIA_JWT_ISSUER=","PROTOCOLIA_JWT_AUDIENCE=","PROTOCOLIA_JWT_JWKS_URI=",
    "PROTOCOLIA_JWT_ALLOW_TEST_HTTP=false",
    "# Optional browser OAuth2 Authorization Code + PKCE (requires a CORS-enabled public token endpoint).",
    "PROTOCOLIA_OIDC_AUTHORIZATION_ENDPOINT=","PROTOCOLIA_OIDC_TOKEN_ENDPOINT=",
    "PROTOCOLIA_OIDC_CLIENT_ID=","PROTOCOLIA_OIDC_REDIRECT_URI=","PROTOCOLIA_OIDC_SCOPE=openid profile",
    "# Opt-in strict OIDC discovery issuer/endpoints/JWKS validation at startup.",
    "PROTOCOLIA_OIDC_DISCOVERY_REQUIRED=false",
    "# Verify signed OIDC ID token, nonce and subject on login (requires strict discovery).",
    "PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED=false",
    "# NestJS-only opt-in BFF; credentials stay in encrypted PostgreSQL sessions.",
    "PROTOCOLIA_BFF_ENABLED=false",
    "# Concurrent-safe expired BFF session cleanup, default 5 minutes.",
    "PROTOCOLIA_BFF_CLEANUP_INTERVAL_MS=300000","PROTOCOLIA_BFF_ENCRYPTION_KEY=",
    "# Optional comma-separated retired keys for transitional decryption only (max 3).",
    "PROTOCOLIA_BFF_DECRYPTION_KEYS=",
    "PROTOCOLIA_OIDC_BFF_REDIRECT_URI=",
    "PROTOCOLIA_ALLOW_DEMO_AUTH=false",
    "PROTOCOLIA_READER_USERNAME=reader","PROTOCOLIA_READER_PASSWORD=",
    "PROTOCOLIA_MANAGER_USERNAME=manager","PROTOCOLIA_MANAGER_PASSWORD=", 
    "# Optional test-only third subject: must supply all three when enabled.",
    "PROTOCOLIA_SCOPED_USERNAME=","PROTOCOLIA_SCOPED_PASSWORD=","PROTOCOLIA_SCOPED_CAPABILITIES=",""
  ].join("\n"));
  write("compose.yaml",[
    "services:","  db:","    image: postgres:16.15-alpine",
    "    environment:","      POSTGRES_DB: protocolia",
    "      POSTGRES_USER: protocolia",
    '      POSTGRES_PASSWORD: ${PROTOCOLIA_DB_PASSWORD:?set PROTOCOLIA_DB_PASSWORD}',
    '    volumes: ["protocolia_nest_data:/var/lib/postgresql/data"]',
    "    healthcheck:",
    '      test: ["CMD-SHELL", "pg_isready -U protocolia -d protocolia"]',
    "      interval: 5s","      retries: 15",
    "  app:","    build: .","    ports:",
    '      - "127.0.0.1:${PROTOCOLIA_HOST_PORT:-8080}:8080"',
    "    depends_on:","      db:","        condition: service_healthy",
    "    environment:",'      PORT: "8080"',
    "      PROTOCOLIA_JDBC_URL: postgresql://db:5432/protocolia",
    "      PROTOCOLIA_JDBC_USER: protocolia",
    '      PROTOCOLIA_JDBC_PASSWORD: ${PROTOCOLIA_DB_PASSWORD:?set PROTOCOLIA_DB_PASSWORD}',
    '      PROTOCOLIA_AUTH_MODE: ${PROTOCOLIA_AUTH_MODE:-demo}',
    '      PROTOCOLIA_JWT_ISSUER: ${PROTOCOLIA_JWT_ISSUER:-}',
    '      PROTOCOLIA_JWT_AUDIENCE: ${PROTOCOLIA_JWT_AUDIENCE:-}',
    '      PROTOCOLIA_JWT_JWKS_URI: ${PROTOCOLIA_JWT_JWKS_URI:-}',
    '      PROTOCOLIA_JWT_ALLOW_TEST_HTTP: ${PROTOCOLIA_JWT_ALLOW_TEST_HTTP:-false}',
    '      PROTOCOLIA_OIDC_AUTHORIZATION_ENDPOINT: ${PROTOCOLIA_OIDC_AUTHORIZATION_ENDPOINT:-}',
    '      PROTOCOLIA_OIDC_TOKEN_ENDPOINT: ${PROTOCOLIA_OIDC_TOKEN_ENDPOINT:-}',
    '      PROTOCOLIA_OIDC_CLIENT_ID: ${PROTOCOLIA_OIDC_CLIENT_ID:-}',
    '      PROTOCOLIA_OIDC_REDIRECT_URI: ${PROTOCOLIA_OIDC_REDIRECT_URI:-}',
    '      PROTOCOLIA_OIDC_SCOPE: ${PROTOCOLIA_OIDC_SCOPE:-openid profile}',
    '      PROTOCOLIA_OIDC_DISCOVERY_REQUIRED: ${PROTOCOLIA_OIDC_DISCOVERY_REQUIRED:-false}',
    '      PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED: ${PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED:-false}',
    '      PROTOCOLIA_BFF_ENABLED: ${PROTOCOLIA_BFF_ENABLED:-false}',
    '      PROTOCOLIA_BFF_CLEANUP_INTERVAL_MS: ${PROTOCOLIA_BFF_CLEANUP_INTERVAL_MS:-300000}',
    '      PROTOCOLIA_BFF_ENCRYPTION_KEY: ${PROTOCOLIA_BFF_ENCRYPTION_KEY:-}',
    '      PROTOCOLIA_BFF_DECRYPTION_KEYS: ${PROTOCOLIA_BFF_DECRYPTION_KEYS:-}',
    '      PROTOCOLIA_OIDC_BFF_REDIRECT_URI: ${PROTOCOLIA_OIDC_BFF_REDIRECT_URI:-}',
    '      PROTOCOLIA_ALLOW_DEMO_AUTH: ${PROTOCOLIA_ALLOW_DEMO_AUTH:-false}',
    '      PROTOCOLIA_READER_USERNAME: ${PROTOCOLIA_READER_USERNAME:-reader}',
    '      PROTOCOLIA_READER_PASSWORD: ${PROTOCOLIA_READER_PASSWORD:?set PROTOCOLIA_READER_PASSWORD}',
    '      PROTOCOLIA_MANAGER_USERNAME: ${PROTOCOLIA_MANAGER_USERNAME:-manager}',
    '      PROTOCOLIA_MANAGER_PASSWORD: ${PROTOCOLIA_MANAGER_PASSWORD:?set PROTOCOLIA_MANAGER_PASSWORD}',
    '      PROTOCOLIA_SCOPED_USERNAME: ${PROTOCOLIA_SCOPED_USERNAME:-}',
    '      PROTOCOLIA_SCOPED_PASSWORD: ${PROTOCOLIA_SCOPED_PASSWORD:-}',
    '      PROTOCOLIA_SCOPED_CAPABILITIES: ${PROTOCOLIA_SCOPED_CAPABILITIES:-}',
    "volumes:","  protocolia_nest_data:",""
  ].join("\n"));
  const result={adapter:"nestjs",irVersion:ir.irVersion,
    sourceSha256:createHash("sha256").update(JSON.stringify(ir)).digest("hex"),
    files:contents.sort(),outcomes:"Generated; tests required"};
  write("protocolia-generation.json",JSON.stringify(result,null,2)+"\n");
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,openapi,out]=process.argv.slice(2);
  if(!input||!openapi||!out)throw Error("Usage: generate.mjs ir.json openapi.json out");
  const r=generate(JSON.parse(readFileSync(input,"utf8")),
    JSON.parse(readFileSync(openapi,"utf8")),resolve(out));
  console.log("PROTOCOLIA_NEST_PROJECT_GENERATED "+JSON.stringify({files:r.files.length,sourceSha256:r.sourceSha256}));
}
