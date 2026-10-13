// Fail-closed binding of the ProtocolIA resource/capability declaration to
// the user-owned cache invalidation policy; UI metadata cannot grant rights.
import { readFileSync } from 'node:fs';
const resource = JSON.parse(readFileSync('./contract-bundle/resource-ir.json','utf8'));
const capabilities = JSON.parse(readFileSync('./contract-bundle/capability-manifest.json','utf8'));
const books = resource.resources?.books;
const operations = books?.operations;
const invalidates = books?.invalidates;
const expectedRoles = {create:'createBook',detail:'getBook',list:'listBooks'};
const expectedWrites = {createBook:['books'],adjustStock:['books'],renameBook:['books']};
const fail = (reason) => {throw new Error('PROTOCOLIA_G2_CONTRACT_DRIFT: ' + reason);};
for (const [role,op] of Object.entries(expectedRoles))
 if (operations?.[role] !== op) fail('Resource role ' + role);
if (operations?.actions?.restock !== 'adjustStock') fail('Restock operation');
if (resource.contractVersion === '0.4' && operations?.actions?.rename !== 'renameBook')
 fail('Missing evolved rename operation');
if (books?.model !== 'Book' || books?.identityField !== 'isbn') fail('Book identity');
if (JSON.stringify(Object.keys(invalidates??{}).sort()) !== JSON.stringify(Object.keys(expectedWrites).sort()))
 fail('Unexpected write invalidation keys');
for (const [op,targets] of Object.entries(expectedWrites))
 if (JSON.stringify(invalidates[op]) !== JSON.stringify(targets)) fail('Write cache invalidation ' + op);
for (const [op,capability,method] of [
 ['listBooks','catalog.read','GET'],['getBook','catalog.read','GET'],
 ['createBook','catalog.write','POST'],['adjustStock','catalog.write','PATCH'],
 ...(resource.contractVersion==='0.4' ? [['renameBook','catalog.write','PATCH']] : [])
]) {
 const value = capabilities.operations[op];
 if (!value || value.capability !== capability || value.method !== method)
   fail('Capability mismatch for '+op);
}
console.log('G2_CACHE_CAPABILITY_MANIFEST_VERIFIED');
