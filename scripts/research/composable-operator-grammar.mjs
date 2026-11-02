// P2 grammar v0.1/v0.2: compose three reviewed primitives (reserve, transition,
// release) over source-defined entity and field names. No executable code,
// caller-controlled privileges, SQL, conditional expressions or external effects.
// Source validity and provenance are separate from authenticating its author.
import {requireOperatorVersions,validateReservePrimitive,validateTerminalTransitionPrimitives} from "./operator-catalog-v1.mjs";
const bad=(reason)=>{throw Error("OPERATOR_ASSEMBLY_INVALID: "+reason);};
const need=(ok,reason)=>{if(!ok)bad(reason);};
const plain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const exact=(x,keys,label)=>need(plain(x)&&Object.keys(x).length===keys.length&&
 Object.keys(x).every(k=>keys.includes(k)),label+" has unexpected/missing fields");
const name=x=>typeof x==="string"&&/^[A-Z][A-Za-z0-9]{2,36}$/.test(x);
const field=x=>typeof x==="string"&&/^[a-z][A-Za-z0-9]{1,32}$/.test(x)&&x!=="id";
const state=x=>typeof x==="string"&&/^[a-z][a-z0-9_]{1,32}$/.test(x);

const suffix=x=>typeof x==="string"&&/^[a-z][a-z0-9-]{1,25}$/.test(x);
const bounded=(x,min,max,label)=>need(Number.isSafeInteger(x)&&x>=min&&x<=max,label+" out of range");
const q=JSON.stringify;
const prop=(name,type,extra={})=>({name,type,required:true,nullable:false,...extra});
const route=x=>"/api/"+x;
const op=(name,entity,kind,path,capability)=>({name,entity,kind,path,capability});
export function composeOperatorGraph(source){
 const versioned=source?.schemaVersion==="protocolia-operator-assembly/v0.2";
 exact(source,versioned?["schemaVersion","namespace","title","entities","operators","operatorVersions"]:
  ["schemaVersion","namespace","title","entities","operators"],"source");
 need(versioned||source.schemaVersion==="protocolia-operator-assembly/v0.1","unsupported grammar");
 const verifiedCatalog=versioned?requireOperatorVersions(source.operatorVersions):null;
 need(name(source.namespace)&&source.namespace.endsWith("Lab"),"namespace must be a laboratory");
 need(typeof source.title==="string"&&source.title.trim()===source.title&&
  source.title.length>=3&&source.title.length<=120&&
  !/[\u0000-\u001f\u007f]/.test(source.title),"invalid title");
 need(Array.isArray(source.entities)&&source.entities.length===2,"two entities required");
 const [p,c]=source.entities;
 exact(p,["name","route","identity","label","capacity"],"parent entity");
 exact(c,["name","route","identity","reference","quantity","status"],"journal entity");
 need(name(p.name)&&name(c.name)&&p.name!==c.name,"entity naming conflict");
 // Generated TypeSpec shares one namespace for entity models, request/page
 // DTOs, health and HTTP errors. Reject collisions *before* emission, not
 // after writing a misleading "validated" IR. Case folding also protects
 // derived capability scopes in both generated backends.
 need(p.name.toLowerCase()!==c.name.toLowerCase(),"entity capability namespace collision");
 const modelSymbols=new Set(["Health","NotFound","Conflict","BadRequest",
  "Unauthorized","Forbidden"].map(x=>x.toLowerCase()));
 for(const entity of [p,c]){
  for(const symbol of [entity.name,entity.name+"Request",entity.name+"Page"]){
   need(!modelSymbols.has(symbol.toLowerCase()),"generated TypeSpec model name collision");
   modelSymbols.add(symbol.toLowerCase());
  }
 }
 need(suffix(p.route)&&suffix(c.route)&&p.route!==c.route,"invalid routes");
 for(const e of [p,c]){
  exact(e.identity,["name","maxLength"],"identity");
  need(field(e.identity.name),"unsafe identity field");
  bounded(e.identity.maxLength,12,120,"identity length");
 }
 exact(p.label,["name","maxLength"],"parent label");
 exact(p.capacity,["name","max"],"capacity");
 exact(c.reference,["name","target"],"journal reference");
 exact(c.quantity,["name","max"],"journal units");
 exact(c.status,["name","initial"],"journal state");
 need(field(p.label.name)&&field(p.capacity.name)&&
  field(c.reference.name)&&field(c.quantity.name)&&field(c.status.name),"unsafe field name");
 need(c.reference.target===p.name,"journal reference target must be the parent");
 bounded(p.label.maxLength,8,255,"label max");
 bounded(p.capacity.max,7,100000,"capacity max");
 bounded(c.quantity.max,2,1000,"claim max");
 need(c.quantity.max<=p.capacity.max,"claim exceeds capacity");
 need(state(c.status.initial),"invalid initial state");
 for(const e of [p,c]){
  const fields=e===p?
    [e.identity.name,e.label.name,e.capacity.name]:
    [e.identity.name,e.reference.name,e.quantity.name,e.status.name];
  need(new Set(fields).size===fields.length,"field collision");
 }
 need(Array.isArray(source.operators)&&source.operators.length>=3&&source.operators.length<=5,
  "operators must contain reserve and 2-4 transitions");
 const reserves=source.operators.filter(x=>x.kind==="reserve");
 const transitions=source.operators.filter(x=>x.kind==="transition");
 need(reserves.length===1&&transitions.length===source.operators.length-1,
  "only reserve and transition operators permitted");
 validateReservePrimitive(reserves[0],p.name,c.name);
 validateTerminalTransitionPrimitives(transitions,c.status.initial);
 // CRUD and health operations are generated alongside user-named transitions.
 // A transition named like one of these can otherwise produce duplicate
 // TypeSpec operations or ambiguous adapter routing/capability metadata.
 const operationSymbols=new Set(["health",...[p,c].flatMap(e=>
  ["create"+e.name,"get"+e.name,"list"+e.name+"s"])].map(x=>x.toLowerCase()));
 for(const transition of transitions){
  need(!operationSymbols.has(transition.name.toLowerCase()),
   "generated TypeSpec operation name collision");
  operationSymbols.add(transition.name.toLowerCase());
 }
 const capacityOps={
  stockEntity:p.name,availableField:p.capacity.name,
  referenceField:c.reference.name,quantityField:c.quantity.name
 };
 const entities=[
  {name:p.name,view:"Available capacity",publicIdentity:p.identity.name,fields:[
   prop(p.identity.name,"string",{minLength:1,maxLength:p.identity.maxLength,unique:true}),
   prop(p.label.name,"string",{minLength:1,maxLength:p.label.maxLength}),
   prop(p.capacity.name,"int32",{min:0,max:p.capacity.max})
  ]},
  {name:c.name,view:"Journal of requested capacity",publicIdentity:c.identity.name,fields:[
   prop(c.identity.name,"string",{minLength:1,maxLength:c.identity.maxLength,unique:true}),
   prop(c.reference.name,"string",{minLength:1,maxLength:p.identity.maxLength,
    reference:{target:p.name,onDelete:"restrict"}}),
   prop(c.quantity.name,"int32",{min:1,max:c.quantity.max}),
   prop(c.status.name,"string",{initial:c.status.initial})
  ]}
 ];
 const primary=e=>{
  const ePath=route(e.route),read=e.name.toLowerCase()+".read",write=e.name.toLowerCase()+".write";
  return [
   op("create"+e.name,e.name,"create",ePath,write),
   op("get"+e.name,e.name,"get",ePath+"/{"+e.identity.name+"}",read),
   op("list"+e.name+"s",e.name,"listPage",ePath,read)
  ];
 };
 const [parentOps,childOps]=[primary(p),primary(c)];
 childOps[0].reserve=capacityOps;
 const transitionOps=transitions.map(t=>({
  ...op(t.name,c.name,"transition",route(c.route)+"/{"+c.identity.name+"}/"+t.suffix,
    c.name.toLowerCase()+".write"),
  field:c.status.name,from:t.from,to:t.to,audit:[c.status.name],
  ...(t.release?{release:capacityOps}:{})
 }));
 const graph={
  schemaVersion:versioned?"protocolia-composable-operator-ir/v0.2":"protocolia-composable-operator-ir/v0.1",
  namespace:source.namespace,title:source.title,grammarSource:structuredClone(source),
  ...(versioned?{operatorCatalog:verifiedCatalog}:{}),
  entities,operations:[...parentOps,...childOps,...transitionOps,
   op("health",p.name,"health","/health","public")]
 };
 return graph;
}
export function validateOperatorGraph(graph){
 exact(graph,graph?.schemaVersion==="protocolia-composable-operator-ir/v0.2"?
  ["schemaVersion","namespace","title","grammarSource","operatorCatalog","entities","operations"]:
  ["schemaVersion","namespace","title","grammarSource","entities","operations"],"operator IR");
 const rebuilt=composeOperatorGraph(graph.grammarSource);
 need(graph.schemaVersion===rebuilt.schemaVersion&&q(graph)===q(rebuilt),
  "graph differs from validated operator composition");
 return graph;
}
function fieldLines(f,identity){
 const lines=[];
 if(f.name===identity)lines.push("@publicIdentity");
 if(f.unique)lines.push("@unique");
 if(f.reference)lines.push("@reference("+q(f.reference.target)+", "+q(f.reference.onDelete)+")");
 if(f.minLength!==undefined)lines.push("@minLength("+f.minLength+")");
 if(f.maxLength!==undefined)lines.push("@maxLength("+f.maxLength+")");
 if(f.min!==undefined)lines.push("@minValue("+f.min+")");
 if(f.max!==undefined)lines.push("@maxValue("+f.max+")");
 if(f.initial!==undefined)lines.push("@initial("+q(f.initial)+")");
 return [...lines.map(l=>"    "+l),"    "+f.name+": "+f.type+";"];
}
export function emitOperatorTypeSpec(graph){
 validateOperatorGraph(graph);
 const entities=graph.entities;
 const lines=['import "@typespec/http";','import "@protocolia/domain";',
  "using TypeSpec.Http;","using ProtocolIA.Domain;","",
  "@service(#{ title: "+q(graph.title)+" })",
  "namespace "+graph.namespace+" {"];
 for(const e of entities){
  lines.push("  @entity","  @view("+q(e.view)+")","  model "+e.name+" {");
  for(const f of e.fields)lines.push(...fieldLines(f,e.publicIdentity));
  lines.push("  }","  model "+e.name+"Request {");
  for(const f of e.fields.filter(f=>f.initial===undefined))
   lines.push(...fieldLines({...f,unique:false,reference:undefined},null));
  lines.push("  }",
   "  model "+e.name+"Page {",
   "    items: "+e.name+"[];",
   "    @minValue(1) @maxValue(50) limit: int32;",
   "    @minValue(0) offset: int32;",
   "    @minValue(0) total: int32;","  }");
 }
 lines.push("  model Health { status: string; }",
  ...[["NotFound",404],["Conflict",409],["BadRequest",400],["Unauthorized",401],["Forbidden",403]]
   .map(([name,number])=>"  @error model "+name+" { @statusCode _: "+number+"; message: string; }"));
 for(const op of graph.operations){
  const entity=entities.find(e=>e.name===op.entity);
  lines.push("  @route("+q(op.path)+")",
   "  @"+({create:"post",get:"get",listPage:"get",transition:"post",health:"get"}[op.kind]),
   "  @behavior("+[q(op.kind),q(op.entity),...(op.kind==="transition"?[q(op.field)]:[])].join(", ")+")");
  if(op.reserve)lines.push("  @reserve("+Object.values(op.reserve).map(q).join(", ")+")");
  if(op.kind==="transition"){
   lines.push("  @transition("+q(op.from)+", "+q(op.to)+")");
   if(op.release)lines.push("  @release("+Object.values(op.release).map(q).join(", ")+")");
   lines.push("  @audit("+q(op.audit.join(","))+")");
  }
  lines.push("  @capability("+q(op.capability)+")");
  if(op.kind==="create"){
   const body=entity===entities[0]?"item":"claim";
   lines.push("  op "+op.name+"(@body input: "+entity.name+"Request):",
    "    { @statusCode _: 201; @body "+body+": "+entity.name+"; } | Conflict | BadRequest | Unauthorized | Forbidden;");
  }else if(op.kind==="get"){
   lines.push("  op "+op.name+"(@path "+entity.publicIdentity+": string): "+
    entity.name+" | NotFound | Unauthorized | Forbidden;");
  }else if(op.kind==="listPage"){
   lines.push("  op "+op.name+"(",
    "    @query @minValue(1) @maxValue(50) limit?: int32 = 25,",
    "    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0",
    "  ): "+entity.name+"Page | BadRequest | Unauthorized | Forbidden;");
  }else if(op.kind==="transition"){
   lines.push("  op "+op.name+"(@path "+entity.publicIdentity+": string):",
    "    "+entity.name+" | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;");
  }else lines.push("  op health(): Health;");
 }
 return [...lines,"}",""].join("\n");
}
