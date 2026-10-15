// Contract-to-app ownership seal. Managed files are immutable between builds;
// consumer configuration and extensions live in intentionally separate paths.
import {createHash} from "node:crypto";
import {existsSync,readFileSync,readdirSync,writeFileSync,statSync} from "node:fs";
import {join,relative,sep} from "node:path";

const sources=[
  "src/main/java","src/main/resources","src/main.ts","src/manifest.json","src/schema.sql","src/migrations","web/src",
  "pom.xml","Dockerfile","compose.yaml",".env.example",".dockerignore",
  "web/package.json","web/package-lock.json","web/index.html","web/vite.config.mjs",
  "package.json","package-lock.json","tsconfig.json",
  "protocolia-generation.json","protocolia-build.json","protocolia-contract-ir.json","protocolia-contract-openapi.json",
  "protocolia-overdue-rules.json"
];
function walk(root,path,result){
  if(!existsSync(join(root,path)))return;
  const full=join(root,path);
  if(statSync(full).isFile()){result.push(path.split(sep).join("/"));return;}
  for(const entry of readdirSync(full,{withFileTypes:true})){
    if(entry.isSymbolicLink())throw Error("Symbolic link inside managed files: "+join(path,entry.name));
    if(!entry.isDirectory()&&!entry.isFile())throw Error("Unsupported generated file entry");
    walk(root,join(path,entry.name),result);
  }
}
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
export function managedDigests(folder){
  const paths=[];
  for(const path of sources)walk(folder,path,paths);
  paths.sort();
  return Object.fromEntries(paths.map(path=>[path,digest(readFileSync(join(folder,path)))]));
}
export function sealApp(folder){
  const digests=managedDigests(folder);
  if(!digests["protocolia-contract-ir.json"]||!digests["protocolia-contract-openapi.json"]||!digests["protocolia-build.json"])
    throw Error("Cannot seal output without its compiled contract and build metadata");
  const seal={schema:1,algorithm:"sha256",files:digests};
  writeFileSync(join(folder,"protocolia-ownership.json"),JSON.stringify(seal,null,2)+"\n");
  return seal;
}
export function verifyApp(folder){
  const location=join(folder,"protocolia-ownership.json");
  if(!existsSync(location))throw Error("Unsealed output: existing application cannot be safely evolved");
  const record=JSON.parse(readFileSync(location,"utf8"));
  if(record.schema!==1||record.algorithm!=="sha256"||!record.files||Array.isArray(record.files))
    throw Error("Unsupported ownership seal");
  const actual=managedDigests(folder),expected=record.files;
  const missing=Object.keys(expected).filter(p=>actual[p]!==expected[p]);
  const added=Object.keys(actual).filter(p=>!Object.hasOwn(expected,p));
  if(missing.length||added.length)
    throw Error("Managed files modified/removed/added; refusing overwrite. Changed: "+
      [...missing,...added].join(", "));
  // The only consumer-owned areas are extensions/ and the local .env.
  const allowed=new Set(["src","web","target","dist","node_modules",".protocolia-toolchain","extensions",
    "package.json","package-lock.json","tsconfig.json",
    ".env","pom.xml","Dockerfile","compose.yaml",".env.example",".dockerignore",
    "protocolia-generation.json","protocolia-build.json","protocolia-contract-ir.json",
    "protocolia-ownership.json","protocolia-contract-openapi.json","protocolia-overdue-rules.json"]);
  for(const entry of readdirSync(folder,{withFileTypes:true})){
    if(!allowed.has(entry.name)||entry.isSymbolicLink())
      throw Error("Unexpected consumer file outside extensions/: "+entry.name);
  }
  return record;
}
