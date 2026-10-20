import {compileRecipientInboxes,recipientInboxSql,assertInboxOpenApi} from "../recipient-inbox.mjs";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import {buildQueryPlan,assertQueryOpenApi} from "../query-plan.mjs";
import {compileOverduePolicies,overdueSchemaSql} from "../overdue-policy.mjs";
import {assertDecimalField,assertComputedProduct,assertComputedRoundedProduct,assertComputedDiscountedTotal,decimalSql,assertDecimalWireSchema} from "../exact-decimal.mjs";
import {compileRelatedSums} from "../related-sum.mjs";
import {compileDetailSums} from "../detail-sum.mjs";
import {compileExactDebits,compileExactReversals} from "../exact-debit.mjs";
import {compileExactReconciliations} from "../exact-reconciliation.mjs";
import {compileOwnerScopes} from "../owner-scope.mjs";
import {uniqueTogetherSql} from "../composite-uniqueness.mjs";
import {assertPatchTogether} from "../compound-patch.mjs";
import {assertMoveUnits,assertReverseUnits} from "../stock-transfer.mjs";
import {assertMoveBatch,assertReverseBatch} from "../multi-leg-transfer.mjs";
import {assertCreateDetails} from "../create-details.mjs";
import {uniqueWhenSql} from "../conditional-uniqueness.mjs";
import { fileURLToPath } from "node:url";

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "templates");
const j = (v) => JSON.stringify(v);
const n = (v) => typeof v === "number" && Number.isInteger(v) ? String(v) : "null";
function name(value) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) throw Error("Unsafe identifier " + JSON.stringify(value));
  return value;
}
const snake = (v) => name(v).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const resolveRef = (obj, value) => {
  if (value?.$ref) return value.$ref.split("/").slice(1).reduce((current, key) => current?.[key], obj);
  return value;
};
function queryParameter(spec, op, parameter) {
  const source = resolveRef(spec,spec.paths[op.path][op.method.toLowerCase()].parameters.find((p) => {
    const d = resolveRef(spec,p); return d?.name === parameter && d?.in === "query";
  }));
  const schema = resolveRef(spec,source?.schema);
  if (!schema || !Number.isInteger(schema.default) || !Number.isInteger(schema.minimum) ||
      !Number.isInteger(schema.maximum)) throw Error("Unresolved query bounds/default for " + op.name + "." + parameter);
  return schema;
}
function inputBounds(spec, op) {
  const operation = spec.paths[op.path]?.[op.method.toLowerCase()];
  const requestBody = resolveRef(spec,operation?.requestBody);
  const schema = resolveRef(spec,requestBody?.content?.["application/json"]?.schema);
  const field = resolveRef(spec,schema?.properties?.[op.behavior.input]);
  if (!field || !Number.isInteger(field.minimum) || !Number.isInteger(field.maximum))
    throw Error("Unresolved atomic increment input bounds from TypeSpec OpenAPI");
  return field;
}
export function generate(ir, openapi, outDir) {
  if(ir.irVersion !== "vnext-a0.1") throw Error("Unsupported canonical IR version");
  if(!Array.isArray(ir.entities)||ir.entities.length===0||ir.entities.length>8)
    throw Error("Modular A4 supports 1–8 entities");
  const YEAR_MONTH_PATTERN="^[0-9]{4}-(0[1-9]|1[0-2])$";
  const entities=ir.entities;
  const entityMap=new Map();
  const tableNames=new Set();
  for(const e of entities){
    name(e.name);
    if(entityMap.has(e.name)||tableNames.has(snake(e.name)))
      throw Error("Duplicate entity or SQL table identifier");
    uniqueTogetherSql(e); // Reject malformed or unsupported IR before any output.
    uniqueWhenSql(e,ir.operations); // Reject unsafe partial uniqueness early.
    entityMap.set(e.name,e);
    tableNames.add(snake(e.name));
    const identity=e.fields.find(f=>f.name===e.publicIdentity);
    if(!identity||identity.type!=="string"||!identity.unique||!identity.required||identity.nullable)
      throw Error("External identity must be a required unique string");
    const cols=new Set();
    for(const f of e.fields){
      name(f.name);
      if(cols.has(snake(f.name)))throw Error("Duplicate SQL column identifier");
      cols.add(snake(f.name));
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
      if(!["string","int32","utcDateTime","decimal"].includes(f.type))
        throw Error("Unsupported field type: "+f.type);
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
    }
  }
  for(const e of entities)for(const f of e.fields){
    if(!f.reference)continue;
    const parent=entityMap.get(f.reference.target);
    const pk=parent?.fields.find(x=>x.name===parent.publicIdentity);
    if(!parent||parent===e||f.reference.onDelete!=="restrict"||
       f.type!=="string"||!f.required||f.nullable||!pk||pk.type!=="string"||
       (f.maxLength??255)<(pk.maxLength??255))
      throw Error("Unsupported FK "+e.name+"."+f.name+": reference another entity's public identity with onDelete=restrict");
  }
  const supported = new Set(["create","get","listPage","queryPage","auditPage","inboxPage","ackNotification","patchFields","patchTogether","atomicIncrement","transition","reassignReference","sumRelated","sumDetails","reconcileExact","replaceDetails","delete","health"]);
  const methods = {create:"POST",get:"GET",listPage:"GET",queryPage:"GET",auditPage:"GET",inboxPage:"GET",ackNotification:"POST",patchFields:"PATCH",patchTogether:"PATCH",atomicIncrement:"PATCH",transition:"POST",reassignReference:"PATCH",sumRelated:"GET",sumDetails:"GET",reconcileExact:"GET",replaceDetails:"PUT",delete:"DELETE",health:"GET"};
  const success = {create:201,get:200,listPage:200,queryPage:200,auditPage:200,inboxPage:200,ackNotification:200,patchFields:200,patchTogether:200,atomicIncrement:200,transition:200,reassignReference:200,sumRelated:200,sumDetails:200,reconcileExact:200,replaceDetails:200,delete:204,health:200};
  const ops = ir.operations;
  const inboxes=compileRecipientInboxes(ir);
  const relatedSums=compileRelatedSums(ir);
  const detailSums=compileDetailSums(ir);
  const exactDebits=compileExactDebits(ir);
  const exactReversals=compileExactReversals(ir);
  const exactReconciliations=compileExactReconciliations(ir);
  const ownerScopes=compileOwnerScopes(ir);
  const fieldReadCapabilities=[...new Set(ir.entities.flatMap(e=>e.fields.map(f=>f.readCapability).filter(Boolean)))];
  for(const op of ops)assertInboxOpenApi(openapi,op);
  const routes = new Set();
  for(const op of ops){
    if(!supported.has(op.behavior.kind)) throw Error("Unsupported operation " + op.behavior.kind);
    const bound=entityMap.get(op.entity);
    if(!bound || !/^[A-Z]+$/.test(op.method) ||
      !/^\/[A-Za-z0-9_\/{}-]+$/.test(op.path)) throw Error("Unsupported routing/entity binding");
    if(op.method !== methods[op.behavior.kind] ||
       !Array.isArray(op.statuses) || !op.statuses.includes(success[op.behavior.kind]))
      throw Error("Contract HTTP verb/status mismatch in " + op.name);
    if(op.behavior.kind==="patchTogether")assertPatchTogether(bound,op);
    if(op.behavior.kind==="patchFields"&&bound.uniqueTogether?.includes(op.behavior.field)){
      const f=bound.fields.find(x=>x.name===op.behavior.field);
      if(!f||f.type!=="string"||!f.required||f.nullable||f.reference||
         f.ownerManaged||f.initial!==undefined||op.behavior.input!==f.name||
         ![400,404,409].every(status=>op.statuses.includes(status)))
        throw Error("Unsafe compound-key PATCH "+op.name);
    }
    const key=bound.publicIdentity;
    const placeholders=[...op.path.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(m=>m[1]);
    const requiresKey=["get","auditPage","patchFields","patchTogether","atomicIncrement","transition","reassignReference","sumRelated","sumDetails","reconcileExact","delete"].includes(op.behavior.kind);
    if(requiresKey && (placeholders.length!==1 || placeholders[0]!==key))
      throw Error("Public identity path must contain {" + key + "} in " + op.name);
    if(!requiresKey && placeholders.length!==0 && op.behavior.kind!=="ackNotification")
      throw Error("Unexpected route placeholders in " + op.name);
    const routeKey=op.method+" "+op.path;
    if(routes.has(routeKey))throw Error("Duplicate HTTP route: "+routeKey);
    routes.add(routeKey);
    if(op.capability==="public" && op.behavior.kind!=="health") throw Error("Anonymous operations not supported in this A0 profile");
    if(op.behavior.kind==="queryPage"){buildQueryPlan(ir,op);assertQueryOpenApi(openapi,op);}
    if(op.behavior.kind==="auditPage"){
      const history=ops.filter(x=>x.entity===bound.name&&x.behavior.audit?.length);
      const create=ops.find(x=>x.entity===bound.name&&x.behavior.kind==="create");
      const get=ops.find(x=>x.entity===bound.name&&x.behavior.kind==="get");
      if(!history.length||op.capability==="public"||
         op.capability===create?.capability||op.capability===get?.capability||
         !op.statuses.includes(400)||!op.statuses.includes(404)||
         op.behavior.field||op.behavior.input||op.behavior.audit||op.behavior.reserve||op.behavior.release)
        throw Error("Invalid independently authorized audit query "+op.name);
    }
    if(op.behavior.audit){
      const a=op.behavior.audit;
      if(!Array.isArray(a)||a.length<1||a.length>8||new Set(a).size!==a.length||
         !["create","transition","reassignReference","patchFields"].includes(op.behavior.kind)&&
           !(op.behavior.kind==="delete"&&ops.some(x=>x.behavior.createDetails?.versioned&&
             x.behavior.createDetails.childEntity===bound.name&&
             a.includes(x.behavior.createDetails.parentField)))||
         a.some(field=>!bound.fields.some(f=>f.name===field))||
         (["transition","reassignReference","patchFields"].includes(op.behavior.kind)&&(a.length!==1||a[0]!==op.behavior.field))||
         (["create","delete"].includes(op.behavior.kind)&&a.includes(bound.publicIdentity)))
        throw Error("Invalid audited mutation "+op.name);
    }
    if(op.behavior.moveUnits)assertMoveUnits(ir,bound,op);
    if(op.behavior.moveBatch)assertMoveBatch(ir,bound,op);
    if(op.behavior.createDetails)assertCreateDetails(ir,bound,op);
    if(op.behavior.reverseBatch)assertReverseBatch(ir,bound,op);
    if(op.behavior.reverseUnits)assertReverseUnits(ir,bound,op);
    if(op.behavior.reserve){
      const r=op.behavior.reserve,stock=entityMap.get(r.stockEntity);
      const available=stock?.fields.find(x=>x.name===r.availableField);
      const relation=bound.fields.find(x=>x.name===r.referenceField);
      const amount=bound.fields.find(x=>x.name===r.quantityField);
      if(op.behavior.kind!=="create"||!stock||stock===bound||
         !available||available.type!=="int32"||!available.required||available.nullable||
         (available.min??-1)<0 || !relation || relation.type!=="string" ||
         relation.reference?.target!==stock.name || !relation.required || relation.nullable ||
         !amount || amount.type!=="int32" || !amount.required || amount.nullable ||
         (amount.min??-1)<1 || !op.statuses.includes(400)||!op.statuses.includes(409))
        throw Error("Invalid atomic cross-entity reserve "+op.name);
    }
    if(op.behavior.release){
      const r=op.behavior.release,stock=entityMap.get(r.stockEntity);
      const available=stock?.fields.find(x=>x.name===r.availableField);
      const relation=bound.fields.find(x=>x.name===r.referenceField);
      const amount=bound.fields.find(x=>x.name===r.quantityField);
      const state=bound.fields.find(x=>x.name===op.behavior.field);
      const matching=ops.filter(x=>x.entity===bound.name && x.behavior.kind==="create" &&
        x.behavior.reserve && Object.keys(r).every(k=>x.behavior.reserve[k]===r[k]));
      if(op.behavior.kind!=="transition"||!state?.initial||
         op.behavior.from!==state.initial||!stock||stock===bound||
         !available||available.type!=="int32"||!available.required||available.nullable||(available.min??-1)<0||
         !relation||relation.reference?.target!==stock.name||relation.type!=="string"||!relation.required||relation.nullable||
         !amount||amount.type!=="int32"||!amount.required||amount.nullable||(amount.min??-1)<1||
         matching.length!==1||
         ops.some(x=>x.entity===bound.name&&x.behavior.kind==="transition"&&
           x.behavior.field===state.name&&x.behavior.from===op.behavior.to))
        throw Error("Invalid exactly-once stock release "+op.name);
    }
    if(op.behavior.kind==="reassignReference"){
      const f=bound.fields.find(x=>x.name===op.behavior.field);
      if(!f?.reference||f.type!=="string"||!f.required||f.nullable||
         f.initial!==undefined||op.behavior.input!==f.name||
         !op.behavior.audit||op.behavior.audit.length!==1||
         op.behavior.audit[0]!==f.name||
         ![400,404,409].every(status=>op.statuses.includes(status))||
         op.behavior.reserve||op.behavior.release||op.behavior.from||op.behavior.to)
        throw Error("Invalid guarded FK reassignment "+op.name);
    }
    if(op.behavior.kind==="transition"){
      const f=bound.fields.find(x=>x.name===op.behavior.field);
      const b=op.behavior;
      const safe=x=>typeof x==="string" && /^[a-z][a-z0-9_-]{0,63}$/.test(x) &&
        x.length>=(f?.minLength??1) && x.length<=(f?.maxLength??255);
      if(!f||!f.initial||f.type!=="string"||!f.required||f.nullable||
        !safe(b.from)||!safe(b.to)||b.from===b.to||b.input)
        throw Error("Invalid guarded transition "+op.name);
      if(!op.statuses.includes(409))throw Error("Transition must declare 409 "+op.name);
    }
    if(["atomicIncrement","patchFields"].includes(op.behavior.kind)){
      const f=bound.fields.find(x=>x.name===op.behavior.field);
      if(!f||op.behavior.input!==op.behavior.field&&op.behavior.kind==="patchFields") throw Error("Unsupported field/input mapping");
      if(op.behavior.kind==="atomicIncrement"&&f.type!=="int32") throw Error("Atomic addition requires int32 field");
      if(op.behavior.kind==="patchFields"&&(
         f.nullable||f.initial!==undefined||
         (f.type!=="string"&&!(
           f.type==="int32"&&op.behavior.audit?.length===1&&
           (f.min??0)>=1&&(f.max??2147483647)<=1000000000))))
        throw Error("Current patchFields runtime requires non-null string or audited bounded positive int32 field");
    }
  }
  const byKind=(kind,entity)=>ops.filter(o=>o.behavior.kind===kind&&(!entity||o.entity===entity));
  if(byKind("health").length!==1)throw Error("Exactly one health operation required");
  const readCaps=[],writeCaps=[],auditCaps=[],assignmentCaps=[];
  for(const e of entities){
    for(const kind of ["create","get","listPage"])
      if(byKind(kind,e.name).length!==1)throw Error("Entity "+e.name+" requires one "+kind);
    for(const kind of ["patchTogether","atomicIncrement","auditPage","queryPage","reassignReference","replaceDetails","delete"])
      if(byKind(kind,e.name).length>1)throw Error("Duplicate "+kind+" for "+e.name);
    const edits=byKind("patchFields",e.name);
    const associated=ops.some(op=>op.behavior.createDetails?.childEntity===e.name);
    if(edits.length>1&&(!associated||edits.length>3||
      new Set(edits.map(op=>op.behavior.field)).size!==edits.length||
      edits.some(op=>op.behavior.audit?.length!==1)))
      throw Error("Only unique audited child fields support multiple PATCH operations");
    const read=byKind("get",e.name)[0].capability;
    const write=byKind("create",e.name)[0].capability;
    if(!read||!write||read===write||read==="public"||write==="public")
      throw Error("Invalid capabilities on "+e.name);
    if(!readCaps.includes(read))readCaps.push(read);
    if(!writeCaps.includes(write))writeCaps.push(write);
    const auditRead=byKind("auditPage",e.name)[0];
    if(auditRead){
      if(auditRead.capability===read||auditRead.capability===write||
         !ops.some(x=>x.entity===e.name&&x.behavior.audit?.length))
        throw Error("Audit view must have an independent capability and source events");
      if(!auditCaps.includes(auditRead.capability))auditCaps.push(auditRead.capability);
    }
    for(const op of ops.filter(o=>o.entity===e.name&&o.behavior.kind==="reassignReference")){
      if(op.capability==="public"||op.capability===read||op.capability===write||op.capability===auditRead?.capability)
        throw Error("Reference reassignment needs a separate capability");
      if(!assignmentCaps.includes(op.capability))assignmentCaps.push(op.capability);
    }
    for(const op of ops.filter(o=>o.entity===e.name&&o.behavior.kind!=="health")){
      if(["auditPage","reassignReference","inboxPage","ackNotification"].includes(op.behavior.kind))continue;
      const expected=["create","patchFields","patchTogether","atomicIncrement","transition","reassignReference","replaceDetails","delete"].includes(op.behavior.kind)?write:read;
      const ownerPatch=op.behavior.kind==="patchFields"&&e.fields.some(f=>f.ownerManaged);
      if(ownerPatch){
        if(!op.capability||op.capability==="public"||op.capability===read||op.capability===write)
          throw Error("Owner field patch requires independent capability "+op.name);
        if(!writeCaps.includes(op.capability))writeCaps.push(op.capability);
      }else if(op.behavior.kind==="patchFields"&&associated&&op.behavior.audit?.length===1){
        if(!op.capability||op.capability==="public"||op.capability===read||
          op.capability===auditRead?.capability)
          throw Error("Invalid independently authorized detail editor "+op.name);
        if(!writeCaps.includes(op.capability))writeCaps.push(op.capability);
      }else if(op.capability!==expected)throw Error("Inconsistent capability on "+op.name);
    }
  }
  readCaps.push(...new Set(inboxes.map(r=>r.readCapability)));
  assignmentCaps.push(...new Set(inboxes.map(r=>r.ackCapability)));
  if(readCaps.some(x=>writeCaps.includes(x))||auditCaps.some(x=>readCaps.includes(x)||writeCaps.includes(x))||assignmentCaps.some(x=>readCaps.includes(x)||writeCaps.includes(x)||auditCaps.includes(x)))throw Error("Read/write/audit authorities cannot overlap");
  if(existsSync(outDir) && readdirSync(outDir,{withFileTypes:true}).length>0)throw Error("Output is not empty; refusing to overwrite consumer files");
  const base="src/main/java/dev/protocolia/modular/";
  const outputs=[];
  function write(path,data) {
    const full=join(outDir,path);
    mkdirSync(dirname(full),{recursive:true});
    writeFileSync(full,data);
    outputs.push(path);
  }
  function copy(path,source) {
    const full=join(outDir,path);
    mkdirSync(dirname(full),{recursive:true});
    copyFileSync(join(toolRoot,source),full);
    outputs.push(path);
  }
  const overdueRules=compileOverduePolicies(ir);
  const queryPlans=ops.filter(op=>op.behavior.kind==="queryPage").map(op=>({op,plan:buildQueryPlan(ir,op)}));
  for(const op of ops.filter(o=>o.behavior.kind==="create"))
    assertDecimalWireSchema(openapi,op,entityMap.get(op.entity));
  const classes=[
    "package dev.protocolia.modular;",
    "import java.util.List;",
    "public final class Manifest {",
    "  private Manifest() {}",
    "  public static final boolean HAS_OVERDUE_RULES="+(overdueRules.length>0?"true":"false")+";",
    "  public record Field(String name,String column,String type,boolean required,boolean nullable,Integer min,Integer max,Integer minLength,Integer maxLength,String pattern,String referenceTarget,String initial,boolean computed,List<String> choices,String requiredSource,String requiredValue,String forbidSource,String forbidValue,Integer precision,Integer scale,String decimalMin,String decimalMax,String afterField,String greaterThanField,String readCapability) {}",
    "  public record OwnerRelation(String field,String parentTable,String parentKey,String parentOwnerColumn,String parentReadCapability) {}",
    "  public record Entity(String name,String table,String identity,String identityColumn,String ownerField,String ownerColumn,OwnerRelation ownerRelation,List<Field> fields) {}",
    "  public record Reserve(String stockTable,String stockKeyColumn,String availableColumn,String referenceField,String amountField,String stockWriteCapability) {}",
    "  public record MoveUnits(String stockTable,String stockKeyColumn,String availableColumn,String sourceField,String targetField,String amountField,int maxBalance,String parentWriteCapability) {}",
    "  public record MoveLeg(String sourceField,String targetField,String quantityField) {}",
    "  public record CreateDetails(String childEntity,String parentField,String rowsField,String childWriteCapability,int maxRows,boolean versioned,String closeField,String closeState) {}",
    "  public record MoveBatch(String stockTable,String stockKeyColumn,String availableColumn,int maxBalance,String parentWriteCapability,List<MoveLeg> legs) {}",
    "  public record ReverseUnits(String stockTable,String stockKeyColumn,String availableColumn,String sourceColumn,String targetColumn,String amountColumn,int maxBalance,String parentWriteCapability) {}",
    "  public record ExactDebit(String balanceTable,String balanceKey,String balanceColumn,String referenceField,String amountField,String parentWriteCapability) {}",
    "  public record ExactReverse(String balanceTable,String balanceKey,String balanceColumn,String referenceColumn,String amountColumn,String parentWriteCapability,String maxBalance) {}",
    "  public record QueryFilter(String name,String expression,String comparator,String type,Integer minLength,Integer maxLength,Integer min,Integer max,String pattern) {}",
    "  public record QuerySpec(String projection,String source,String order,List<QueryFilter> filters) {}",
    "  public record RelatedSum(String sql,String childReadCapability) {}",
    "  public record ExactReconciliation(String parentEntity,String sql,String childReadCapability,String openingField,String availableField) {}",
    "  public static final java.util.Map<String,ExactReconciliation> EXACT_RECONCILIATIONS=java.util.Map.ofEntries(",
    [...exactReconciliations.entries()].map(([key,v])=>"    java.util.Map.entry("+j(key)+",new ExactReconciliation("+
      [j(v.parentEntity),j(v.sqlSpring),j(v.childReadCapability),j(v.openingField),j(v.availableField)].join(",")+"))").join(",\\n"),
    "  );",
    "  public static final java.util.Map<String,RelatedSum> RELATED_SUMS=java.util.Map.ofEntries(",
    [...relatedSums.entries()].map(([name,plan])=>"    java.util.Map.entry("+j(name)+",new RelatedSum("+j(plan.sqlSpring)+","+j(plan.childReadCapability)+"))").join(",\\n"),
    "  );",
    "  public static final java.util.Map<String,RelatedSum> DETAIL_SUMS=java.util.Map.ofEntries(",
    [...detailSums.entries()].map(([name,plan])=>"    java.util.Map.entry("+j(name)+",new RelatedSum("+j(plan.sqlSpring)+","+j(plan.childReadCapability)+"))").join(",\\n"),
    "  );",
    "  public static final java.util.Map<String,QuerySpec> QUERIES=java.util.Map.ofEntries(",
    queryPlans.map(({op,plan})=>"    java.util.Map.entry("+j(op.name)+",new QuerySpec("+
      [j(plan.projection),j(plan.source),j(plan.order),"List.of("+
        plan.filters.map(f=>"new QueryFilter("+[
          j(f.name),j(f.expression),j(f.comparator),j(f.type),
          n(f.minLength),n(f.maxLength),n(f.min),n(f.max),f.pattern?j(f.pattern):"null"
        ].join(",")+")").join(",")+")"].join(",")+
      "))").join(",\n"),
    "  );",
    "  public record Op(String name,String method,String path,String entity,String kind,String capability,String field,String input,int inputMin,int inputMax,int limitDefault,int limitMin,int limitMax,int offsetDefault,int offsetMax,String fromState,String toState,Reserve reserve,Reserve release,ExactDebit exactDebit,ExactReverse exactReverse,MoveUnits moveUnits,ReverseUnits reverseUnits,MoveBatch moveBatch,MoveBatch reverseBatch,CreateDetails createDetails,List<String> audit) {}",
    "  public static final List<String> READ_CAPABILITIES=List.of("+readCaps.map(j).join(",")+");",
    "  public static final List<String> WRITE_CAPABILITIES=List.of("+writeCaps.map(j).join(",")+");",
    "  public static final List<String> AUDIT_CAPABILITIES=List.of("+auditCaps.map(j).join(",")+");",
    "  public static final List<String> FIELD_READ_CAPABILITIES=List.of("+fieldReadCapabilities.map(j).join(",")+");",
    "  public static final List<String> ASSIGN_CAPABILITIES=List.of("+assignmentCaps.map(j).join(",")+");",
    "  public static final List<Entity> ENTITIES=List.of(",
    entities.map(e=>{
      const parts=e.fields.map(f=>"      new Field("+[
        j(f.name),j(snake(f.name)),j(f.type),f.required,f.nullable,
        n(f.min),n(f.max),n(f.minLength),n(f.maxLength),f.pattern?j(f.pattern):"null",f.reference?j(f.reference.target):"null",f.initial!==undefined?j(f.initial):"null",Boolean(f.computedSum||f.computedProduct||f.computedRoundedProduct||f.computedDiscountedTotal),
        "List.of("+(f.choices??[]).map(c=>j(c.value)).join(",")+")",
        f.requiredWhen?j(f.requiredWhen.field):"null",f.requiredWhen?j(f.requiredWhen.equals):"null",
        f.forbidWhen?j(f.forbidWhen.field):"null",f.forbidWhen?j(f.forbidWhen.equals):"null",
        n(f.decimal?.precision),n(f.decimal?.scale),f.decimal?.min!==undefined?j(f.decimal.min):"null",f.decimal?.max!==undefined?j(f.decimal.max):"null",
        f.afterField!==undefined?j(f.afterField):"null",
        f.greaterThanField!==undefined?j(f.greaterThanField):"null",
        f.readCapability!==undefined?j(f.readCapability):"null"
      ].join(",")+")").join(",\n");
      const owned=ownerScopes.get(e.name);
      const rel=owned?.relation;
      const ownerRelation=rel?"new OwnerRelation("+[j(rel.field),j(rel.parentTable),j(rel.parentKey),j(rel.parentOwnerColumn),j(rel.parentReadCapability)].join(",")+")":"null";
      return "    new Entity("+[j(e.name),j(snake(e.name)),j(e.publicIdentity),j(snake(e.publicIdentity)),owned?j(owned.field):"null",owned?j(owned.column):"null",ownerRelation].join(",")+
        ",List.of(\n"+parts+"\n    ))";
    }).join(",\n"),
    "  );",
    "  public static final List<Op> OPS=List.of(",
  ];
  const mapped=ops.filter(op=>op.behavior.kind!=="health").map(op=>{
    const b=op.behavior;
    let mn=0,mx=0,ld=0,lmin=0,lmax=0,od=0,om=0;
    if(b.kind==="atomicIncrement"){
      const range=inputBounds(openapi,op);mn=range.minimum;mx=range.maximum;
    }
    if(["listPage","queryPage","auditPage","inboxPage"].includes(b.kind)){
      const l=queryParameter(openapi,op,"limit");
      const o=queryParameter(openapi,op,"offset");
      ld=l.default;lmin=l.minimum;lmax=l.maximum;od=o.default;om=o.maximum;
    }
    let reserve="null";
    if(b.reserve){
      const stock=entityMap.get(b.reserve.stockEntity);
      const stockWrite=byKind("create",stock.name)[0]?.capability;
      if(!stockWrite||stockWrite==="public")throw Error("Missing stock write capability");
      reserve="new Reserve("+[
        j(snake(stock.name)),j(snake(stock.publicIdentity)),j(snake(b.reserve.availableField)),
        j(b.reserve.referenceField),j(b.reserve.quantityField),j(stockWrite)
      ].join(",")+")";
    }
    let moveUnits="null";
    if(b.moveUnits){
      const plan=assertMoveUnits(ir,entityMap.get(op.entity),op);
      moveUnits="new MoveUnits("+[
        j(snake(plan.stock.name)),j(snake(plan.stock.publicIdentity)),
        j(snake(plan.available.name)),j(b.moveUnits.sourceField),
        j(b.moveUnits.targetField),j(b.moveUnits.quantityField),
        n(plan.available.max??2147483647),j(plan.parentWriteCapability)
      ].join(",")+")";
    }
    let reverseUnits="null";
    if(b.reverseUnits){
      const plan=assertReverseUnits(ir,entityMap.get(op.entity),op);
      reverseUnits="new ReverseUnits("+[
        j(snake(plan.stock.name)),j(snake(plan.stock.publicIdentity)),
        j(snake(plan.available.name)),j(snake(plan.source.name)),
        j(snake(plan.target.name)),j(snake(plan.amount.name)),
        n(plan.available.max??2147483647),j(plan.parentWriteCapability)
      ].join(",")+")";
    }
    let moveBatch="null";
    if(b.moveBatch){
      const plan=assertMoveBatch(ir,entityMap.get(op.entity),op);
      moveBatch="new MoveBatch("+[
        j(snake(plan.stock.name)),j(snake(plan.stock.publicIdentity)),
        j(snake(plan.available.name)),n(plan.available.max??2147483647),
        j(plan.parentWriteCapability),"List.of("+
          plan.legs.map(leg=>"new MoveLeg("+[
            j(leg.sourceField),j(leg.targetField),j(leg.quantityField)
          ].join(",")+")").join(",")+")"
      ].join(",")+")";
    }
    let reverseBatch="null";
    if(b.reverseBatch){
      const plan=assertReverseBatch(ir,entityMap.get(op.entity),op);
      reverseBatch="new MoveBatch("+[
        j(snake(plan.stock.name)),j(snake(plan.stock.publicIdentity)),
        j(snake(plan.available.name)),n(plan.available.max??2147483647),
        j(plan.parentWriteCapability),"List.of("+
          plan.legs.map(leg=>"new MoveLeg("+[
            j(snake(leg.sourceField)),j(snake(leg.targetField)),j(snake(leg.quantityField))
          ].join(",")+")").join(",")+")"
      ].join(",")+")";
    }
    let createDetails="null";
    if(b.createDetails){
      const plan=assertCreateDetails(ir,entityMap.get(op.entity),op);
      createDetails="new CreateDetails("+[
        j(plan.child.name),j(plan.relation.name),j(plan.rowsField),
        j(plan.childWriteCapability),n(plan.maxRows),b.createDetails.versioned===true?"true":"false",
        j(b.createDetails.closeField??""),j(b.createDetails.closeState??"")
      ].join(",")+")";
    }
    let release="null";
    if(b.release){
      const stock=entityMap.get(b.release.stockEntity);
      const stockWrite=byKind("create",stock.name)[0]?.capability;
      if(!stockWrite||stockWrite==="public")throw Error("Missing stock write capability");
      release="new Reserve("+[
        j(snake(stock.name)),j(snake(stock.publicIdentity)),j(snake(b.release.availableField)),
        j(b.release.referenceField),j(b.release.quantityField),j(stockWrite)
      ].join(",")+")";
    }
    const debit=exactDebits.get(op.name);
    const exactDebit=debit?"new ExactDebit("+[
      j(debit.balanceTable),j(debit.balanceKey),j(debit.balanceColumn),
      j(debit.referenceField),j(debit.amountField),j(debit.parentWriteCapability)
    ].join(",")+")":"null";
    const reversal=exactReversals.get(op.name);
    const exactReverse=reversal?"new ExactReverse("+[
      j(reversal.balanceTable),j(reversal.balanceKey),j(reversal.balanceColumn),
      j(reversal.referenceColumn),j(reversal.amountColumn),
      j(reversal.parentWriteCapability),j(reversal.maxBalance)
    ].join(",")+")":"null";
    return "    new Op("+[j(op.name),j(op.method),j(op.path),j(op.entity),j(b.kind),
      j(op.capability),j(b.field??""),j(b.input??""),
      mn,mx,ld,lmin,lmax,od,om,j(b.from??""),j(b.to??""),reserve,release,exactDebit,exactReverse,moveUnits,reverseUnits,moveBatch,reverseBatch,createDetails,"List.of("+(b.audit??[]).map(j).join(",")+")"].join(",")+")";
  });
  classes.push(mapped.join(",\n"),"  );","}");
  write(base+"Manifest.java",classes.join("\n")+"\n");
  for(const filename of ["ContractApplication.java","SecurityConfig.java","DomainRuntime.java","BffSession.java","BffKeyring.java","BffHttpSessionConfig.java"]) copy(base+filename,filename);
  copy("pom.xml","pom.xml");
  copy("src/main/resources/application.properties","application.properties");
  copy("src/main/resources/db/migration/V2__protocolia_bff_http_session.sql","BffHttpSessionSchema.sql");
  const resources=entities.map(entity=>({
    entity,view:entity.view??entity.name,
    transitions:ops.filter(op=>op.entity===entity.name&&op.behavior.kind==="transition").map(op=>({name:op.name,method:op.method,path:op.path,capability:op.capability,behavior:op.behavior})),
    patchFieldsOptions:ops.filter(op=>op.entity===entity.name&&op.behavior.kind==="patchFields")
      .map(op=>({name:op.name,method:op.method,path:op.path,capability:op.capability,behavior:op.behavior})),
    operations:Object.fromEntries(ops.filter(op=>op.entity===entity.name&&op.behavior.kind!=="health"&&op.behavior.kind!=="transition").map(op=>[
      op.behavior.kind,{method:op.method,path:op.path,capability:op.capability,behavior:op.behavior}
    ]))
  }));
  write("src/main/resources/static/protocolia-ui.json",JSON.stringify({
    ...resources[0], resources
  },null,2)+"\n");
  for(const file of [
    "package.json","index.html","vite.config.mjs",
    "src/main.jsx","src/App.jsx","src/OAuthPkce.js","src/AuthSession.js","src/PagedReferencePicker.jsx","src/NotificationInbox.jsx","src/style.css"
  ]) copy("web/"+file,"web/"+file);
  for(const file of ["Dockerfile","compose.yaml",".env.example",".dockerignore"])
    copy(file,file);
  const sql=[];
  for(const e of entities){
    const table=snake(e.name),key=e.publicIdentity;
    const columns=e.fields.map(f=>{
      const col=snake(f.name);
      const type=f.type==="string"?"VARCHAR("+(f.maxLength??255)+")":
        f.type==="int32"?"INTEGER":f.type==="decimal"?decimalSql(f,col).type:"TIMESTAMP WITH TIME ZONE";
      const checks=[];
      if(f.name===key)checks.push("PRIMARY KEY");
      if(f.required&&!f.nullable)checks.push("NOT NULL");
      if(f.unique&&f.name!==key)checks.push("UNIQUE");
      if(f.type==="string"&&f.minLength!==undefined)
        checks.push("CHECK (char_length("+col+") >= "+f.minLength+")");
      if(f.type==="string"&&f.required&&!f.nullable)
        checks.push("CHECK (char_length(btrim("+col+")) > 0)");
      if(f.pattern!==undefined)checks.push("CHECK ("+col+" ~ '"+YEAR_MONTH_PATTERN+"' )");
      if(f.choices?.length)checks.push("CHECK ("+col+" IN ("+f.choices.map(c=>"'"+c.value+"'").join(",")+"))");
      if(f.min!==undefined)checks.push("CHECK ("+col+">="+f.min+")");
      if(f.max!==undefined)checks.push("CHECK ("+col+"<="+f.max+")");
      if(f.type==="decimal")checks.push(...decimalSql(f,col).checks);
      if(f.initial!==undefined){
        const values=new Set([f.initial,...ops.filter(op=>
          op.entity===e.name&&op.behavior.kind==="transition"&&op.behavior.field===f.name)
          .flatMap(op=>[op.behavior.from,op.behavior.to])]);
        if(values.size<2||[...values].some(x=>typeof x!=="string"||!/^[a-z][a-z0-9_-]{0,63}$/.test(x)))
          throw Error("Unresolved finite state values "+e.name+"."+f.name);
        checks.push("CHECK ("+col+" IN ("+[...values].sort().map(x=>"'"+x+"'").join(",")+"))");
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
      return "  "+col+" "+type+generated+" "+checks.join(" ");
    });
    const conditional=e.fields.filter(f=>f.requiredWhen).map(f=>{
      const col=snake(f.name),source=snake(f.requiredWhen.field);
      return "  CONSTRAINT ck_cond_"+table+"_"+col+" CHECK ("+
        source+" IS DISTINCT FROM '"+f.requiredWhen.equals+"' OR "+
        "("+col+" IS NOT NULL AND char_length(btrim("+col+")) > 0))";
    });
    const forbidden=e.fields.filter(f=>f.forbidWhen).map(f=>{
      const col=snake(f.name),source=snake(f.forbidWhen.field);
      return "  CONSTRAINT ck_forbid_"+table+"_"+col+" CHECK ("+
        source+" IS DISTINCT FROM '"+f.forbidWhen.equals+"' OR "+col+" IS NULL)";
    });
    const chronological=e.fields.filter(f=>f.afterField!==undefined).map(f=>{
      const col=snake(f.name),source=snake(f.afterField);
      return "  CONSTRAINT ck_order_"+table+"_"+col+" CHECK ("+
        col+" IS NULL OR "+col+" > "+source+")";
    });
    const compared=e.fields.filter(f=>f.greaterThanField!==undefined).map(f=>{
      const col=snake(f.name),source=snake(f.greaterThanField);
      return "  CONSTRAINT ck_gt_"+table+"_"+col+" CHECK ("+
        col+" IS NULL OR "+col+" > "+source+")";
    });
    const versioned=ops.some(op=>op.entity===e.name&&op.behavior.createDetails?.versioned);
    sql.push("CREATE TABLE "+table+" (\n"+[...columns,...(versioned?["  document_version INTEGER NOT NULL DEFAULT 1 CHECK (document_version >= 1)"]:[]),...conditional,...forbidden,...chronological,...compared,...uniqueTogetherSql(e)].join(",\n")+"\n);");
  }
  for(const e of entities)sql.push(...uniqueWhenSql(e,ops));
  for(const e of entities)for(const f of e.fields){
    if(!f.reference)continue;
    const parent=entityMap.get(f.reference.target);
    sql.push("ALTER TABLE "+snake(e.name)+" ADD CONSTRAINT fk_"+snake(e.name)+"_"+
      snake(f.name)+" FOREIGN KEY ("+snake(f.name)+") REFERENCES "+
      snake(parent.name)+" ("+snake(parent.publicIdentity)+") ON DELETE RESTRICT;");
  }
  if(ops.some(op=>op.behavior.audit))sql.push(
    "CREATE TABLE protocolia_audit_event (id BIGSERIAL PRIMARY KEY, "+
    "actor VARCHAR(255) NOT NULL, entity_name VARCHAR(128) NOT NULL, "+
    "resource_id VARCHAR(255) NOT NULL, operation_name VARCHAR(128) NOT NULL, "+
    "field_name VARCHAR(128) NOT NULL, before_value TEXT, after_value TEXT, "+
    "occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);",
    "CREATE INDEX idx_protocolia_audit_resource ON protocolia_audit_event (entity_name,resource_id,id);");
  const queryIndexDdl=new Set(queryPlans.flatMap(x=>x.plan.ddl));
  sql.push(...queryIndexDdl);
  sql.push(...overdueSchemaSql(overdueRules),...recipientInboxSql(inboxes));
  if(overdueRules.length)write("protocolia-overdue-rules.json",JSON.stringify(
    overdueRules.map(({ddl,...policy})=>policy),null,2)+"\n");
  const signature=createHash("sha256").update(JSON.stringify(entities)).digest("hex");
  write("src/main/resources/db/migration/V1__contract_baseline.sql",
    "-- ProtocolIA schema SHA256 "+signature+" (generated from canonical IR)\n"+
    sql.join("\n")+"\n");
  const manifest={
    adapter:"modular-spring-a0",irVersion:ir.irVersion,sourceSha256:createHash("sha256").update(JSON.stringify(ir)).digest("hex"),
    supportedKinds:[...supported].sort(),outcomes:"Generated; not proof of compilation or HTTP conformance",
    files:outputs.sort()
  };
  write("protocolia-generation.json",JSON.stringify(manifest,null,2)+"\n");
  return manifest;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [irFile,openapiFile,output]=process.argv.slice(2);
  if(!irFile||!openapiFile||!output)throw Error("Usage: node generate.mjs ir.json openapi.json output-dir");
  const manifest=generate(JSON.parse(readFileSync(irFile,"utf8")),JSON.parse(readFileSync(openapiFile,"utf8")),resolve(output));
  console.log("MODULAR_A0_PROJECT_GENERATED "+JSON.stringify({files:manifest.files.length,sourceSha256:manifest.sourceSha256}));
}
