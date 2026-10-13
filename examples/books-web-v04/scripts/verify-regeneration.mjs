import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const owned=['src/api/http.ts','src/api/cache.ts'];
const before=owned.map(digest);
const walk = (folder) => readdirSync(folder).flatMap(name => {
 const path=folder+'/'+name;
 return statSync(path).isDirectory()?walk(path):[path];
}).sort();
const command=() => execFileSync('npm',['run','generate'],{stdio:'inherit'});
command();
const generated=walk('src/generated/orval');
const first=generated.map(digest);
command();
const generatedAgain=walk('src/generated/orval');
const second=generatedAgain.map(digest);
if (JSON.stringify(generated)!==JSON.stringify(generatedAgain) ||
    JSON.stringify(first)!==JSON.stringify(second))
 throw new Error('Orval regeneration not byte-identical');
if (JSON.stringify(before)!==JSON.stringify(owned.map(digest)))
 throw new Error('Orval touched user-owned fetch/cache adapter');
console.log('G2_ORVAL_REGEN_DETERMINISTIC_AND_USER_CODE_INTACT',generated.length);
