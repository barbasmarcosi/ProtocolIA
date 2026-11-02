import {renderBoundedCapacityTypeSpec} from "./bounded-capacity-renderer.mjs";
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
export function emitStockTypeSpec(ir){
 assertGraph(ir);
 return renderBoundedCapacityTypeSpec(ir,{StockItem:"item",StockDebit:"debit"});
}
export function validateStockSemanticIr(ir){return assertGraph(ir);}
