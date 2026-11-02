// Reusable TypeSpec emission for *independently validated* capacity/reservation IRs.
// This module is NOT an authority validator. Callers MUST reconstruct their exact
// profile-specific graph and prove equality before invoking this renderer.
const q=JSON.stringify;
function annotate(field,identity){
 const items=[];
 if(field.name===identity)items.push("@publicIdentity");
 if(field.unique)items.push("@unique");
 if(field.reference)items.push("@reference("+q(field.reference.target)+", "+q(field.reference.onDelete)+")");
 if(field.minLength!==undefined)items.push("@minLength("+field.minLength+")");
 if(field.maxLength!==undefined)items.push("@maxLength("+field.maxLength+")");
 if(field.min!==undefined)items.push("@minValue("+field.min+")");
 if(field.max!==undefined)items.push("@maxValue("+field.max+")");
 if(field.initial!==undefined)items.push("@initial("+q(field.initial)+")");
 return [...items.map(s=>"    "+s),"    "+field.name+": "+field.type+";"];
}
function model(name,fields,view,identity){
 const lines=[...(view===null?[]:["  @entity","  @view("+q(view)+")"]),"  model "+name+" {"];
 for(const f of fields)lines.push(...annotate(f,identity));
 return lines.concat(["  }",""]).join("\n");
}
function input(name,fields){
 const lines=["  model "+name+" {"];
 for(const f of fields)lines.push(...annotate({...f,unique:false,reference:undefined,initial:undefined},null));
 return lines.concat(["  }",""]).join("\n");
}
function page(name){
 return ["  model "+name+"Page {","    items: "+name+"[];",
  "    @minValue(1) @maxValue(50) limit: int32;",
  "    @minValue(0) offset: int32;",
  "    @minValue(0) total: int32;","  }",""].join("\n");
}
function operation(op,entity,aliases){
 const methods={create:"post",get:"get",listPage:"get",transition:"post",health:"get"};
 if(!Object.hasOwn(methods,op.kind))throw Error("Unreviewed capacity operation kind");
 const pre=["  @route("+q(op.path)+")","  @"+methods[op.kind],
  "  @behavior("+[q(op.kind),q(op.entity)].concat(op.kind==="transition"?[q(op.stateField)]:[]).join(", ")+")"];
 if(op.reserve)pre.push("  @reserve("+["stockEntity","availableField","referenceField","quantityField"]
  .map(k=>q(op.reserve[k])).join(", ")+")");
 if(op.kind==="transition"){
  pre.push("  @transition("+q(op.from)+", "+q(op.to)+")");
  pre.push("  @release("+["stockEntity","availableField","referenceField","quantityField"]
   .map(k=>q(op.release[k])).join(", ")+")");
  pre.push("  @audit("+q(op.audit.join(","))+")");
 }
 pre.push("  @capability("+q(op.capability)+")");
 let body;
 if(op.kind==="create"){
  if(!Object.hasOwn(aliases,op.entity))throw Error("Unreviewed capacity response alias");
  body="  op "+op.name+"(@body input: "+op.entity+"Request):\n"+
   "      { @statusCode _: 201; @body "+aliases[op.entity]+": "+op.entity+"; }\n"+
   "    | Conflict | BadRequest | Unauthorized | Forbidden;";
 }else if(op.kind==="get"){
  body="  op "+op.name+"(@path "+entity.publicIdentity+": string): "+
   op.entity+" | NotFound | Unauthorized | Forbidden;";
 }else if(op.kind==="listPage"){
  body="  op "+op.name+"(\n"+
   "    @query @minValue(1) @maxValue(50) limit?: int32 = 25,\n"+
   "    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0\n"+
   "  ): "+op.entity+"Page | BadRequest | Unauthorized | Forbidden;";
 }else if(op.kind==="transition"){
  body="  op "+op.name+"(@path "+entity.publicIdentity+": string):\n"+
   "    "+op.entity+" | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;";
 }else if(op.kind==="health")body="  op health(): Health;";
 return pre.concat([body,""]).join("\n");
}
export function renderBoundedCapacityTypeSpec(ir,createAliases){
 // The graph must already have been checked against the profile's independent
 // authoritative constructor. This check catches accidental internal misuse only.
 if(!ir||!Array.isArray(ir.entities)||ir.entities.length!==2||!Array.isArray(ir.operations)||
  ir.operations.length!==8||typeof ir.namespace!=="string")
  throw Error("Only audited two-entity eight-operation capacity graphs are supported");
 if(ir.entities.some(e=>!Object.hasOwn(createAliases,e.name)))
  throw Error("Missing approved response aliases");
 const [parent,child]=ir.entities;
 const blocks=[
  'import "@typespec/http";','import "@protocolia/domain";',
  "using TypeSpec.Http;","using ProtocolIA.Domain;","",
  "@service(#{ title: "+q(ir.title)+" })",
  "namespace "+ir.namespace+" {",
  model(parent.name,parent.fields,parent.view,parent.publicIdentity),
  model(child.name,child.fields,child.view,child.publicIdentity),
  input(parent.name+"Request",parent.fields),
  input(child.name+"Request",child.fields.filter(f=>f.initial===undefined)),
  page(parent.name),page(child.name),
  "  model Health { status: string; }","",
  ...[["NotFound",404],["Conflict",409],["BadRequest",400],["Unauthorized",401],["Forbidden",403]]
   .map(([n,s])=>"  @error model "+n+" { @statusCode _: "+s+"; message: string; }"),
  "",...ir.operations.map(op=>operation(op,ir.entities.find(e=>e.name===op.entity),createAliases)), "}",""
 ];
 return blocks.join("\n");
}
