// P2 v0.3 — compose reviewed state transitions WITHOUT reserve/release.
// The source may name a single entity, fields and a finite acyclic state graph.
// No arbitrary effects, SQL, external calls or user-authored privileges.
import {requireStateOnlyOperatorVersions,validateAuditedStateGraph}
 from "./operator-catalog-v1.mjs";
const invalid=why=>{throw Error("STATE_OPERATOR_INVALID: "+why);};
const ensure=(ok,why)=>{if(!ok)invalid(why);};
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function exact(x,names,where){ensure(object(x)&&Object.keys(x).length===names.length&&
 Object.keys(x).every(k=>names.includes(k)),where+" unknown or missing property");}
const entityName=s=>typeof s==="string"&&/^[A-Z][A-Za-z0-9]{2,36}$/.test(s);
const fieldName=s=>typeof s==="string"&&/^[a-z][A-Za-z0-9]{1,32}$/.test(s)&&s!=="id";
const routeName=s=>typeof s==="string"&&/^[a-z][a-z0-9-]{1,25}$/.test(s);
const bound=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const q=JSON.stringify;
const property=(name,type,opts={})=>({name,type,required:true,nullable:false,...opts});
const op=(name,kind,entity,path,capability)=>({name,kind,entity,path,capability});
export function composeStateOnlyGraph(source){
 const twoRole=source?.schemaVersion==="protocolia-operator-assembly/v0.4";
 exact(source,twoRole?
  ["schemaVersion","namespace","title","profile","entity","operators","operatorVersions","authorizationProfile"]:
  ["schemaVersion","namespace","title","profile","entity","operators","operatorVersions"],
  "state-only source");
 ensure((twoRole||source.schemaVersion==="protocolia-operator-assembly/v0.3")&&
  source.profile==="state-only"&&(!twoRole||source.authorizationProfile==="submit-decide/v1"),
  "unreviewed source version/profile/authorization policy");
 ensure(entityName(source.namespace)&&source.namespace.endsWith("Lab"),"invalid laboratory namespace");
 ensure(typeof source.title==="string"&&source.title.length>=3&&source.title.length<=120&&
  source.title.trim()===source.title&&!/[\u0000-\u001f\u007f]/.test(source.title),
  "invalid title");
 const binding=requireStateOnlyOperatorVersions(source.operatorVersions);
 const e=source.entity;
 exact(e,["name","route","identity","label","status"],"state entity");
 ensure(entityName(e.name)&&routeName(e.route),"invalid entity or path");
 const reserved=new Set(["health","notfound","conflict","badrequest","unauthorized","forbidden"]);
 for(const model of [e.name,e.name+"Request",e.name+"Page"])
  ensure(!reserved.has(model.toLowerCase()),"generated model symbol collision");
 exact(e.identity,["name","maxLength"],"identity");
 exact(e.label,["name","maxLength"],"label");
 exact(e.status,["name","initial"],"status");
 ensure([e.identity.name,e.label.name,e.status.name].every(fieldName)&&
  new Set([e.identity.name,e.label.name,e.status.name]).size===3,
  "reserved or duplicate fields");
 ensure(bound(e.identity.maxLength,12,120)&&bound(e.label.maxLength,12,255),
  "length out of range");
 const approved=validateAuditedStateGraph(source.operators,e.status.initial);
 // Explicit opt-in only. A submitter can move the initial state to review,
 // while either terminal decision requires a distinct, entity-bound grant.
 if(twoRole){
  ensure(source.operators.length===3,"submit-decide requires exactly three audited transitions");
  const root=source.operators.filter(t=>t.from===e.status.initial);
  ensure(root.length===1,"review graph needs a single submit edge");
  const forks=source.operators.filter(t=>t.from===root[0].to);
  ensure(forks.length===2&&forks.every(t=>t.to!==e.status.initial)&&
    forks[0].to!==forks[1].to&&
    source.operators.every(t=>t===root[0]||forks.includes(t)),
    "decision graph must have two exclusive terminal outcomes");
 }
 // Prevent generator-owned CRUD/health symbols from being shadowed by transitions.
 const builtIns=new Set(["health","create"+e.name,"get"+e.name,"list"+e.name+"s"]
  .map(x=>x.toLowerCase()));
 for(const transition of source.operators){
  ensure(!builtIns.has(transition.name.toLowerCase()),"generated operation symbol collision");
  builtIns.add(transition.name.toLowerCase());
 }
 const base="/api/"+e.route;
 const capabilities={read:e.name.toLowerCase()+".read",write:e.name.toLowerCase()+".write",
  submit:e.name.toLowerCase()+".submit",decide:e.name.toLowerCase()+".decide"};
 const operations=[
  op("create"+e.name,"create",e.name,base,capabilities.write),
  op("get"+e.name,"get",e.name,base+"/{"+e.identity.name+"}",capabilities.read),
  op("list"+e.name+"s","listPage",e.name,base,capabilities.read),
  ...source.operators.map(t=>({
   ...op(t.name,"transition",e.name,base+"/{"+e.identity.name+"}/"+t.suffix,
    twoRole?(t.from===e.status.initial?capabilities.submit:capabilities.decide):capabilities.write),
   field:e.status.name,from:t.from,to:t.to,audit:[e.status.name]
  })),
  op("health","health",e.name,"/health","public")
 ];
 return {schemaVersion:twoRole?"protocolia-state-operator-ir/v0.4":"protocolia-state-operator-ir/v0.3",
  namespace:source.namespace,title:source.title,profile:source.profile,
  grammarSource:structuredClone(source),operatorCatalog:binding,
  entities:[{name:e.name,view:"Reviewed state items",publicIdentity:e.identity.name,fields:[
   property(e.identity.name,"string",{minLength:1,maxLength:e.identity.maxLength,unique:true}),
   property(e.label.name,"string",{minLength:1,maxLength:e.label.maxLength}),
   property(e.status.name,"string",{initial:e.status.initial})
  ]}],
  operations,graphProperties:approved
 };
}
export function validateStateOnlyGraph(ir){
 exact(ir,["schemaVersion","namespace","title","profile","grammarSource",
  "operatorCatalog","entities","operations","graphProperties"],"state-only IR");
 const check=composeStateOnlyGraph(ir.grammarSource);
 ensure(ir.schemaVersion===check.schemaVersion&&q(ir)===q(check),
  "compiled graph differs from approved state-only source");
 return ir;
}
export function emitStateOnlyTypeSpec(ir){
 validateStateOnlyGraph(ir);
 const entity=ir.entities[0],src=ir.grammarSource.entity;
 const [key,label,status]=entity.fields;
 const lines=[
  'import "@typespec/http";','import "@protocolia/domain";',
  "using TypeSpec.Http;","using ProtocolIA.Domain;","",
  "@service(#{ title: "+q(ir.title)+" })","namespace "+ir.namespace+" {",
  "  @entity",'  @view("Reviewed state items")',
  "  model "+entity.name+" {",
  "    @publicIdentity","    @unique","    @minLength(1)",
  "    @maxLength("+key.maxLength+")",
  "    "+key.name+": string;",
  "    @minLength(1)","    @maxLength("+label.maxLength+")",
  "    "+label.name+": string;",
  "    @initial("+q(status.initial)+")",
  "    "+status.name+": string;","  }",
  "  model "+entity.name+"Request {",
  "    @minLength(1) @maxLength("+key.maxLength+") "+key.name+": string;",
  "    @minLength(1) @maxLength("+label.maxLength+") "+label.name+": string;","  }",
  "  model "+entity.name+"Page {","    items: "+entity.name+"[];",
  "    @minValue(1) @maxValue(50) limit: int32;",
  "    @minValue(0) offset: int32;",
  "    @minValue(0) total: int32;","  }",
  "  model Health { status: string; }",
  ...[["NotFound",404],["Conflict",409],["BadRequest",400],["Unauthorized",401],["Forbidden",403]]
   .map(([n,s])=>"  @error model "+n+" { @statusCode _: "+s+"; message: string; }")
 ];
 for(const o of ir.operations){
  const http=o.kind==="get"||o.kind==="listPage"||o.kind==="health"?"get":"post";
  lines.push("  @route("+q(o.path)+")","  @"+http,
   "  @behavior("+[q(o.kind),q(o.entity),...(o.kind==="transition"?[q(o.field)]:[])].join(", ")+")");
  if(o.kind==="transition")
   lines.push("  @transition("+q(o.from)+", "+q(o.to)+")",
    "  @audit("+q(status.name)+")");
  lines.push("  @capability("+q(o.capability)+")");
  if(o.kind==="create")lines.push(
   "  op "+o.name+"(@body input: "+entity.name+"Request):",
   "    { @statusCode _: 201; @body item: "+entity.name+"; } | Conflict | BadRequest | Unauthorized | Forbidden;");
  else if(o.kind==="get")lines.push(
   "  op "+o.name+"(@path "+key.name+": string): "+entity.name+" | NotFound | Unauthorized | Forbidden;");
  else if(o.kind==="listPage")lines.push(
   "  op "+o.name+"(",
   "    @query @minValue(1) @maxValue(50) limit?: int32 = 25,",
   "    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0",
   "  ): "+entity.name+"Page | BadRequest | Unauthorized | Forbidden;");
  else if(o.kind==="transition")lines.push(
   "  op "+o.name+"(@path "+key.name+": string):",
   "    "+entity.name+" | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;");
  else lines.push("  op health(): Health;");
 }
 return [...lines,"}",""].join("\n");
}
