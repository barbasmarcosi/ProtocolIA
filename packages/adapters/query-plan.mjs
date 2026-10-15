import {createHash} from "node:crypto";

/**
 * Contract IR -> bounded, parameter-only SQL query plan.
 * This module runs at generation time. Neither identifiers nor SQL fragments
 * originate from HTTP requests. Both adapters use exactly the same plan.
 */
const safe=value=>{
  if(typeof value!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(value))
    throw Error("Unsafe query identifier "+JSON.stringify(value));
  return value;
};
const snake=value=>safe(value).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
const q=value=>'"'+safe(value)+'"';
const table=value=>q(snake(value));
const col=value=>q(snake(value));

export function buildQueryPlan(ir,operation){
 const entity=ir.entities.find(e=>e.name===operation.entity);
 const b=operation.behavior;
 if(!entity||b?.kind!=="queryPage"||operation.method!=="GET"||
    !Array.isArray(operation.statuses)||![200,400].every(x=>operation.statuses.includes(x))||
    /[{}]/.test(operation.path)||b.audit||b.reserve||b.release||b.field||b.input||
    !Array.isArray(b.filters)||b.filters.length<1||b.filters.length>8||
    !b.sort||!["asc","desc"].includes(b.sort.direction)||
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(b.sort.field)||
    operation.capability==="public")
   throw Error("Invalid queryPage operation "+operation.name);
 const sort=entity.fields.find(f=>f.name===b.sort.field);
 if(!sort)throw Error("Unknown query sort field");
 const same=new Set(),viaMap=new Map(),filters=[],indexes=new Map();
 for(const filter of b.filters){
  if(!filter||!safe(filter.parameter)||same.has(filter.parameter)||
     ["limit","offset"].includes(filter.parameter)||!["eq","gte","lte"].includes(filter.operator)||
     !["string","int32","utcDateTime"].includes(filter.type))
   throw Error("Unsafe/duplicate query filter parameter");
  same.add(filter.parameter);
  let owner=entity,alias="t0";
  if(filter.via!==undefined){
   const fk=entity.fields.find(x=>x.name===filter.via);
   owner=ir.entities.find(x=>x.name===fk?.reference?.target);
   if(!owner||!fk?.reference||fk.reference.onDelete!=="restrict"||!fk.required||fk.nullable)
    throw Error("Invalid one-hop query reference "+filter.via);
   alias="j_"+snake(filter.via);
   viaMap.set(filter.via,{alias,target:owner.name,sourceColumn:fk.name,targetKey:owner.publicIdentity});
  }
  const f=owner.fields.find(x=>x.name===filter.field);
  if(!f||f.type!==filter.type||(filter.operator!=="eq"&&!["int32","utcDateTime"].includes(f.type)))
   throw Error("Filter type/operator differs from referenced field "+filter.field);
  const expression=alias+"."+col(f.name);
  filters.push({name:filter.parameter,expression,
    comparator:{eq:"=",gte:">=",lte:"<="}[filter.operator],type:f.type,
    minLength:f.minLength??null,maxLength:f.maxLength??null,min:f.min??null,max:f.max??null});
  const indexKey=owner.name+"."+f.name;
  if(f.name!==owner.publicIdentity)indexes.set(indexKey,{entity:owner.name,field:f.name});
 }
 const joins=[...viaMap.values()].map(v=>" INNER JOIN "+table(v.target)+" "+v.alias+
   " ON t0."+col(v.sourceColumn)+" = "+v.alias+"."+col(v.targetKey));
 const projection="SELECT "+entity.fields.map(f=>"t0."+col(f.name)+' AS "'+safe(f.name)+'"').join(",");
 const source=" FROM "+table(entity.name)+" t0"+joins.join("");
 const order=" ORDER BY t0."+col(sort.name)+" "+b.sort.direction.toUpperCase()+" NULLS LAST"+
   (sort.name===entity.publicIdentity?"":",t0."+col(entity.publicIdentity)+" ASC");
 const ddl=[...indexes.values()].map(entry=>{
   const digest=createHash("sha256").update(entry.entity+"."+entry.field).digest("hex").slice(0,12);
   return "CREATE INDEX IF NOT EXISTS idx_pia_"+digest+" ON "+
     table(entry.entity)+" ("+col(entry.field)+");";
 });
 return {projection,source,order,filters,ddl};
}

/** Verify the official TypeSpec/OpenAPI query surface against compiled allowlisted IR. */
export function assertQueryOpenApi(spec,operation){
 const endpoint=spec?.paths?.[operation.path]?.[operation.method.toLowerCase()];
 if(!endpoint||endpoint.requestBody)throw Error("Unresolved query OpenAPI operation");
 const ref=value=>value?.$ref?value.$ref.split("/").slice(1).reduce((x,k)=>x?.[k],spec):value;
 const entries=(endpoint.parameters??[]).map(ref);
 const fields=operation.behavior.filters;
 const allowed=new Set(["limit","offset",...fields.map(x=>x.parameter)]);
 const actual=entries.filter(p=>p?.in==="query");
 if(actual.length!==allowed.size||actual.some(p=>!allowed.has(p.name))||
    new Set(actual.map(p=>p.name)).size!==actual.length)
   throw Error("Query parameters differ from canonical IR");
 for(const filter of fields){
   const param=actual.find(p=>p.name===filter.parameter);
   const schema=ref(param?.schema);
   if(!param||param.required===true||!schema||
      (filter.type==="utcDateTime"&&!(schema.type==="string"&&schema.format==="date-time"))||
      (filter.type==="int32"&&schema.type!=="integer")||
      (filter.type==="string"&&schema.type!=="string"))
     throw Error("Unbound or incompatible OpenAPI query filter "+filter.parameter);
 }
}
