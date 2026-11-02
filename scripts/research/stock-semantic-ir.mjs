// R2.6 — bounded semantic IR: structured constraints -> typed entities and operation
// graph -> TypeSpec. The caller supplies limits via the frozen source brief;
// no model can synthesize operations, capabilities, references or SQL.
const profile="stock-debit-lab/v0";
const identifiers=["StockItem","StockDebit"];
const permissions=["stock.read","stock.write","stock-debits.read","stock-debits.write","public"];
const operations=["createStockItem","getStockItem","listStockItems","createStockDebit",
 "getStockDebit","listStockDebits","reverseStockDebit","health"];
const requireSafe=(ok,message)=>{if(!ok)throw Error("STOCK_IR_INVALID: "+message);};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function keys(x,expected,label){requireSafe(obj(x)&&Object.keys(x).length===expected.length&&
 Object.keys(x).every(k=>expected.includes(k)),label+" unexpected or missing property");}
function within(n,min,max,label){requireSafe(Number.isSafeInteger(n)&&n>=min&&n<=max,label+" out of bounds");return n;}
const field=(name,type,options={})=>({name,type,required:true,nullable:false,...options});
function sourceProject(p){
 keys(p,["profile","namespace","title","bounds"],"project");
 requireSafe(p.profile===profile&&p.namespace==="StockDebitLab","only audited inventory namespace is supported");
 requireSafe(typeof p.title==="string"&&p.title.length>=2&&p.title.length<=120&&
  p.title.trim()===p.title&&!/[\u0000-\u001f\u007f]/.test(p.title),"title invalid");
 keys(p.bounds,["skuMaxLength","nameMaxLength","stockMaxUnits","debitIdMaxLength","debitMaxUnits"],
  "stock bounds");
 const b=p.bounds;
 within(b.skuMaxLength,8,120,"sku length");
 within(b.nameMaxLength,8,255,"item name length");
 within(b.stockMaxUnits,7,1000000,"stock maximum");
 within(b.debitIdMaxLength,8,120,"debit identity length");
 within(b.debitMaxUnits,2,1000,"debit maximum");
 return b;
}
export function stockSemanticIr(project){
 const b=sourceProject(project);
 const entities=[
  {name:"StockItem",view:"Inventory items",publicIdentity:"sku",fields:[
   field("sku","string",{minLength:1,maxLength:b.skuMaxLength,unique:true}),
   field("name","string",{minLength:1,maxLength:b.nameMaxLength}),
   field("available","int32",{min:0,max:b.stockMaxUnits})
  ]},
  {name:"StockDebit",view:"Stock debit journal",publicIdentity:"debitId",fields:[
   field("debitId","string",{minLength:1,maxLength:b.debitIdMaxLength,unique:true}),
   field("stockSku","string",{minLength:1,maxLength:b.skuMaxLength,
    reference:{target:"StockItem",onDelete:"restrict"}}),
   field("units","int32",{min:1,max:b.debitMaxUnits}),
   field("state","string",{initial:"posted"})
  ]}
 ];
 const readList=(name,entity,kind,path,capability)=>({name,entity,kind,path,capability});
 const graph=[
  readList("createStockItem","StockItem","create","/api/stock-items","stock.write"),
  readList("getStockItem","StockItem","get","/api/stock-items/{sku}","stock.read"),
  readList("listStockItems","StockItem","listPage","/api/stock-items","stock.read"),
  {...readList("createStockDebit","StockDebit","create","/api/stock-debits","stock-debits.write"),
   reserve:{stockEntity:"StockItem",availableField:"available",referenceField:"stockSku",quantityField:"units"}},
  readList("getStockDebit","StockDebit","get","/api/stock-debits/{debitId}","stock-debits.read"),
  readList("listStockDebits","StockDebit","listPage","/api/stock-debits","stock-debits.read"),
  {...readList("reverseStockDebit","StockDebit","transition","/api/stock-debits/{debitId}/reverse","stock-debits.write"),
   stateField:"state",from:"posted",to:"reversed",
   release:{stockEntity:"StockItem",availableField:"available",referenceField:"stockSku",quantityField:"units"},
   audit:["state"]},
  readList("health","StockItem","health","/health","public")
 ];
 return {
  schemaVersion:"protocolia-stock-semantic-ir/v0.1",
  namespace:project.namespace,title:project.title,
  entities,operations:graph,profile:project.profile,
  sourceBounds:{...b}
 };
}
const q=JSON.stringify;
function assertGraph(ir){
 keys(ir,["schemaVersion","namespace","title","entities","operations","profile","sourceBounds"],"typed stock IR");
 requireSafe(ir.schemaVersion==="protocolia-stock-semantic-ir/v0.1"&&
  ir.namespace==="StockDebitLab"&&ir.profile===profile,"unsupported IR");
 const recreated=stockSemanticIr({namespace:ir.namespace,title:ir.title,profile:ir.profile,bounds:ir.sourceBounds});
 // The IR's independently defined operation graph must be exact, not an agent-authored arbitrary graph.
 requireSafe(JSON.stringify(recreated)===JSON.stringify(ir),"semantic graph differs from audited profile");
 requireSafe(ir.entities.map(x=>x.name).join(",")===identifiers.join(","),"entity shape changed");
 requireSafe(ir.operations.map(x=>x.name).join(",")===operations.join(","),"operation set changed");
 requireSafe(ir.operations.every(x=>permissions.includes(x.capability)),"unknown capability");
 return ir;
}
function propertyLines(f,identity){
 const a=[];
 if(f.name===identity)a.push("@publicIdentity");
 if(f.unique)a.push("@unique");
 if(f.reference)a.push("@reference("+q(f.reference.target)+", "+q(f.reference.onDelete)+")");
 if(f.minLength!==undefined)a.push("@minLength("+f.minLength+")");
 if(f.maxLength!==undefined)a.push("@maxLength("+f.maxLength+")");
 if(f.min!==undefined)a.push("@minValue("+f.min+")");
 if(f.max!==undefined)a.push("@maxValue("+f.max+")");
 if(f.initial!==undefined)a.push("@initial("+q(f.initial)+")");
 return a.map(x=>"    "+x).concat(["    "+f.name+": "+f.type+";"]);
}
function emitModel(name,fields,view,identity){
 const lines=["  "+(view===null?"":"@entity"),...(view===null?[]:["  @view("+q(view)+")"]),
  "  model "+name+" {"];
 for(const f of fields)lines.push(...propertyLines(f,identity));
 lines.push("  }","");
 return lines.filter((x,i)=>!(i===0&&x.trim()==="")).join("\n");
}
function emitInput(name,fields){
 const lines=["  model "+name+" {"];
 for(const f of fields)lines.push(...propertyLines({...f,unique:false,reference:undefined,initial:undefined},null));
 return lines.concat(["  }",""]).join("\n");
}
function emitPage(entity){
 return ["  model "+entity+"Page {","    items: "+entity+"[];",
  "    @minValue(1) @maxValue(50) limit: int32;",
  "    @minValue(0) offset: int32;",
  "    @minValue(0) total: int32;","  }",""].join("\n");
}
function renderOperation(op,entity){
 const pre=["  @route("+q(op.path)+")",
  "  @"+({create:"post",get:"get",listPage:"get",transition:"post",health:"get"}[op.kind]),
  "  @behavior("+[q(op.kind),q(op.entity)].concat(op.kind==="transition"?[q(op.stateField)]:[]).join(", ")+")"];
 if(op.reserve)pre.push("  @reserve("+Object.values(op.reserve).map(q).join(", ")+")");
 if(op.kind==="transition"){
  pre.push("  @transition("+q(op.from)+", "+q(op.to)+")");
  pre.push("  @release("+Object.values(op.release).map(q).join(", ")+")");
  pre.push("  @audit("+q(op.audit.join(","))+")");
 }
 pre.push("  @capability("+q(op.capability)+")");
 let signature;
 if(op.kind==="create"){
  const id=op.entity==="StockItem"?"item":"debit";
  signature="  op "+op.name+"(@body input: "+op.entity+"Request):\n"+
   "      { @statusCode _: 201; @body "+id+": "+op.entity+"; }\n"+
   "    | Conflict | BadRequest | Unauthorized | Forbidden;";
 }else if(op.kind==="get"){
  signature="  op "+op.name+"(@path "+entity.publicIdentity+": string): "+
   op.entity+" | NotFound | Unauthorized | Forbidden;";
 }else if(op.kind==="listPage"){
  signature="  op "+op.name+"(\n"+
   "    @query @minValue(1) @maxValue(50) limit?: int32 = 25,\n"+
   "    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0\n"+
   "  ): "+op.entity+"Page | BadRequest | Unauthorized | Forbidden;";
 }else if(op.kind==="transition"){
  signature="  op "+op.name+"(@path "+entity.publicIdentity+": string):\n"+
   "    "+op.entity+" | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;";
 }else if(op.kind==="health")signature="  op health(): Health;";
 else throw Error("unknown bounded operation");
 return pre.concat([signature,""]).join("\n");
}
export function emitStockTypeSpec(ir){
 assertGraph(ir);
 const item=ir.entities[0],debit=ir.entities[1];
 const blocks=[
  'import "@typespec/http";','import "@protocolia/domain";',
  "using TypeSpec.Http;","using ProtocolIA.Domain;","",
  "@service(#{ title: "+q(ir.title)+" })",
  "namespace StockDebitLab {",
  emitModel(item.name,item.fields,item.view,item.publicIdentity),
  emitModel(debit.name,debit.fields,debit.view,debit.publicIdentity),
  emitInput("StockItemRequest",item.fields),
  emitInput("StockDebitRequest",debit.fields.filter(f=>f.initial===undefined)),
  emitPage(item.name),emitPage(debit.name),
  "  model Health { status: string; }","",
  ...[["NotFound",404],["Conflict",409],["BadRequest",400],["Unauthorized",401],["Forbidden",403]]
   .map(([name,status])=>"  @error model "+name+" { @statusCode _: "+status+"; message: string; }"),
  "",...ir.operations.map(op=>renderOperation(op,ir.entities.find(e=>e.name===op.entity))),"}",""
 ];
 return blocks.join("\n");
}
export function validateStockSemanticIr(ir){return assertGraph(ir);}
