#!/usr/bin/env node
// R4 prerequisite: portable, strictly bounded TypeSpec source snapshot.
// Uses only Node built-ins. SHA-256 checks prove byte consistency, not trust,
// authorship, current business approval, compiler compatibility or safety.
import {createHash} from "node:crypto";
import {existsSync,lstatSync,readdirSync,readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {join,resolve,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";

const SHA=/^[0-9a-f]{64}$/;
const SEGMENT=/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const MAX_FILES=128,MAX_FILE_BYTES=2*1024*1024,MAX_TOTAL_BYTES=8*1024*1024;
const digest=x=>createHash("sha256").update(x).digest("hex");
function requireDirectory(path,kind){
  const s=lstatSync(path);
  if(!s.isDirectory()||s.isSymbolicLink())throw Error("Unsafe "+kind+" directory");
}
function requireFile(path,kind){
  const s=lstatSync(path);
  if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_FILE_BYTES)
    throw Error("Unsafe "+kind+" file");
  return readFileSync(path);
}
function scan(root){
  requireDirectory(root,"TypeSpec project");
  // The canonical CLI fingerprint intentionally covers only contracts/*.tsp
  // and tspconfig. The workshop sample also has explanatory README/project
  // metadata, which are not part of that fingerprint or build inputs.
  const auxiliary=new Set(["tsp-output","README.md","protocolia.project.yaml"]);
  const top=readdirSync(root);
  if(!top.includes("contracts")||!top.includes("tspconfig.yaml")||
     top.some(name=>name!=="contracts"&&name!=="tspconfig.yaml"&&!auxiliary.has(name)))
    throw Error("Unreviewed TypeSpec project entry");
  for(const name of top){
    if(name==="tsp-output"&&existsSync(join(root,name))){
      requireDirectory(join(root,name),"TypeSpec compiler output");
    }else if(name==="README.md"||name==="protocolia.project.yaml"){
      requireFile(join(root,name),"auxiliary TypeSpec metadata");
    }
  }
  const result=new Map();
  result.set("tspconfig.yaml",requireFile(join(root,"tspconfig.yaml"),"TypeSpec config"));
  let total=result.get("tspconfig.yaml").length;
  const walk=(dir,rel,depth)=>{
    if(depth>12)throw Error("TypeSpec source tree too deep");
    requireDirectory(dir,"contracts");
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      if(!SEGMENT.test(entry.name)||entry.isSymbolicLink())
        throw Error("Unsafe TypeSpec source entry");
      const full=join(dir,entry.name);
      const name=rel+"/"+entry.name;
      if(entry.isDirectory()){walk(full,name,depth+1);continue;}
      if(!entry.isFile()||!entry.name.endsWith(".tsp"))
        throw Error("Only TypeSpec .tsp source files are supported");
      const bytes=requireFile(full,"TypeSpec source");
      result.set(name,bytes);
      total+=bytes.length;
      if(result.size>MAX_FILES||total>MAX_TOTAL_BYTES)
        throw Error("TypeSpec source snapshot size limit exceeded");
    }
  };
  walk(join(root,"contracts"),"contracts",0);
  if(result.size<2)throw Error("TypeSpec source files missing");
  return new Map([...result].sort(([a],[b])=>a.localeCompare(b,"en")));
}
function sourceDigest(files){
  // EXACTLY the CLI's projectDigest semantics: sorted relative filenames,
  // followed by their bytes. No JSON transformations or TS formatting.
  const h=createHash("sha256");
  for(const path of [...files.keys()].sort()){
    h.update(path);h.update(files.get(path));
  }
  return h.digest("hex");
}
function lockFor(files){
  return {schemaVersion:"protocolia-contract-source/v0.1",algorithm:"sha256",
    contractSha256:sourceDigest(files),
    files:Object.fromEntries([...files].map(([p,b])=>[p,digest(b)])),
    warning:"Unsigned source copy; business authorization and compiler identity are NOT attested"};
}
function safeLock(path){
  const bytes=requireFile(path,"source lock");
  const doc=JSON.parse(bytes.toString("utf8"));
  if(doc?.schemaVersion!=="protocolia-contract-source/v0.1"||
     doc.algorithm!=="sha256"||!SHA.test(doc.contractSha256)||
     !doc.files||typeof doc.files!=="object"||Array.isArray(doc.files))
    throw Error("Unsupported TypeSpec snapshot manifest");
  return doc;
}
export function verifyContractSource(project,lockPath){
  const files=scan(resolve(project)),actual=lockFor(files),prior=safeLock(resolve(lockPath));
  const expectedNames=Object.keys(prior.files).sort(),actualNames=[...files.keys()].sort();
  if(JSON.stringify(expectedNames)!==JSON.stringify(actualNames)||
     prior.contractSha256!==actual.contractSha256||
     actualNames.some(k=>prior.files[k]!==actual.files[k]))
    throw Error("TypeSpec source snapshot drift");
  return {status:"SOURCE_BYTES_REHYDRATABLE_NOT_ATTESTED",
    contractSha256:actual.contractSha256,files:files.size};
}
export function snapshotContractSource(project,out,expectedDigest){
  if(!SHA.test(expectedDigest))throw Error("Missing expected source digest");
  const input=resolve(project),dest=resolve(out);
  if(dest===input||dest.startsWith(input+sep)||input.startsWith(dest+sep))
    throw Error("Source snapshot may not overlap source project");
  const files=scan(input);
  const lock=lockFor(files);
  if(lock.contractSha256!==expectedDigest)
    throw Error("TypeSpec source changed since build fingerprint");
  if(existsSync(dest))throw Error("Source snapshot must not overwrite existing files");
  mkdirSync(dest,{recursive:false});
  for(const [p,bytes] of files){
    const target=join(dest,p);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,bytes,{flag:"wx"});
  }
  const manifest=join(dirname(dest),"protocolia-contract-source.lock.json");
  writeFileSync(manifest,JSON.stringify(lock,null,2)+"\n",{flag:"wx"});
  const result=verifyContractSource(dest,manifest);
  return {...result,unverified:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==5||process.argv[2]!=="verify")
      throw Error("Usage: protocolia-contract-source-verify.mjs verify <source-dir> <lock.json>");
    console.log(JSON.stringify(verifyContractSource(process.argv[3],process.argv[4])));
  }catch(error){
    console.error("PROTOCOLIA_R4_SOURCE_REJECTED "+String(error.message).slice(0,180));
    process.exitCode=1;
  }
}
