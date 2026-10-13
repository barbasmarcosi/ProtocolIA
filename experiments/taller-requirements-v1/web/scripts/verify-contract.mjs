import {readFileSync} from 'node:fs';
const res=JSON.parse(readFileSync('./contract-bundle/resource-ir.json','utf8')).resources?.tools;
const ops=JSON.parse(readFileSync('./contract-bundle/capability-manifest.json','utf8')).operations;
function fail(s){throw Error('TALLER_CONTRACT_DRIFT '+s);}
if(res?.model!=='Tool'||res.identityField!=='code')fail('identity');
for(const [key,op] of Object.entries({create:'createTool',list:'listTools',detail:'getTool'}))
 if(res.operations?.[key]!==op)fail(key);
for(const [key,op] of Object.entries({restock:'increaseQuantity',rename:'renameTool'}))
 if(res.operations.actions?.[key]!==op)fail(key);
for(const [name,cap,method] of [
 ['listTools','inventory.read','GET'],['getTool','inventory.read','GET'],
 ['createTool','inventory.write','POST'],['increaseQuantity','inventory.write','PATCH'],['renameTool','inventory.write','PATCH']]){
 if(ops[name]?.capability!==cap||ops[name]?.method!==method)fail(name);
 if(method!=='GET'&&JSON.stringify(res.invalidates[name])!=='["tools"]')fail('write effects');
}
console.log('TALLER_CONTRACT_CAPABILITIES_PASS');
