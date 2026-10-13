#!/usr/bin/env node
// ProtocolIA vNext — one command, one authoritative TypeSpec contract.
// No agent loops, hidden per-entity source edits, or paid services.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const sha=(value)=>createHash("sha256").update(value).digest("hex");
function run(cmd,args,cwd=repoRoot){
  console.log("PROTOCOLIA_EXEC "+cmd+" "+args.join(" "));
  const child=spawnSync(cmd,args,{cwd,stdio:"inherit",env:process.env,timeout:600000});
  if(child.error)throw child.error;
  if(child.status!==0)throw Error(cmd+" failed with exit status "+child.status);
}
function projectDigest(directory){
  const base=join(directory,"contracts");
  function collect(dir){
    return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
      const full=join(dir,entry.name);
      return entry.isDirectory()?collect(full):entry.isFile()&&entry.name.endsWith(".tsp")?[full]:[];
    });
  }
  const files=[...collect(base),join(directory,"tspconfig.yaml")].sort();
  const fingerprint=createHash("sha256");
  for(const file of files){fingerprint.update(file.slice(directory.length+1));fingerprint.update(readFileSync(file));}
  return fingerprint.digest("hex");
}
function parse(argv){
  if(argv[0]!=="build"||!argv[1])throw Error("Usage: protocolia build <project> --target modular-spring --out <directory>");
  const options={};
  for(let i=2;i<argv.length;i+=2){
    if(!["--target","--out"].includes(argv[i])||!argv[i+1]||options[argv[i]])
      throw Error("Unexpected or missing option "+argv[i]);
    options[argv[i]]=argv[i+1];
  }
  if(options["--target"]!=="modular-spring"||!options["--out"])
    throw Error("Only explicit --target modular-spring is supported");
  return {project:resolve(argv[1]),out:resolve(options["--out"])};
}
function main(){
  const {project,out}=parse(process.argv.slice(2));
  if(!existsSync(join(project,"tspconfig.yaml"))||!existsSync(join(project,"contracts")))
    throw Error("Project requires tspconfig.yaml and contracts/");
  if(out===project||out.startsWith(project+sep))
    throw Error("Refusing to write generated application inside its source contract project");
  if(existsSync(out)&&readdirSync(out).length>0)
    throw Error("Output must be empty; refusing to overwrite consumer files");
  const java=spawnSync("java",["-version"],{encoding:"utf8"});
  if(java.status!==0||!/version "21[."]/.test((java.stderr||"")+(java.stdout||"")))
    throw Error("Java 21 is required by the supported modular-spring profile");
  if(Number(process.versions.node.split(".")[0])<24)
    throw Error("Node.js 24 is required by the pinned React/Vite toolchain");
  const contractSha256=projectDigest(project);
  run("npm",["run","build:vnext"]);
  run(join(repoRoot,"node_modules/.bin/tsp"),["compile",project]);
  const base=join(project,"tsp-output");
  const irPath=join(base,"@protocolia/compiler/ir.json");
  const openapiPath=join(base,"@typespec/openapi3/openapi.json");
  if(!existsSync(irPath)||!existsSync(openapiPath))
    throw Error("TypeSpec emitters did not produce IR and official OpenAPI3");
  run(process.execPath,[join(repoRoot,"packages/adapters/modular/generate.mjs"),irPath,openapiPath,out]);
  run("npm",["install","--ignore-scripts","--no-audit","--no-fund"],join(out,"web"));
  run("npm",["run","build"],join(out,"web"));
  const tooling=join(out,".protocolia-toolchain");
  mkdirSync(tooling,{recursive:true});
  run("mvn",["-B","-ntp","org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy",
    "-Dartifact=org.openapitools:openapi-generator-cli:7.26.0:jar",
    "-DoutputDirectory="+tooling]);
  const jar=join(tooling,"openapi-generator-cli-7.26.0.jar");
  if(!existsSync(jar))throw Error("Expected OpenAPI Generator 7.26.0 jar not found");
  const props="library=spring-boot,interfaceOnly=true,skipDefaultInterface=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.generated.api,modelPackage=dev.protocolia.generated.model,basePackage=dev.protocolia.generated";
  const globals="apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=ApiUtil.java";
  const upstream=join(tooling,"generated");
  run("java",["-jar",jar,"generate","-g","spring","-i",openapiPath,"-o",upstream,
    "--additional-properties="+props,"--global-property="+globals]);
  const from=join(upstream,"src/main/java/dev/protocolia/generated");
  const to=join(out,"src/main/java/dev/protocolia/generated");
  if(!existsSync(from)||existsSync(to))throw Error("OpenAPI generated files missing or target path already owned");
  cpSync(from,to,{recursive:true,force:false,errorOnExist:true});
  run("mvn",["-B","-ntp","-DskipTests","package"],out);
  const metadata={
    builder:"protocolia-cli-vnext-a2",target:"modular-spring",
    contractSha256,irSha256:sha(readFileSync(irPath)),
    openapiSha256:sha(readFileSync(openapiPath)),
    typespec:"1.17.0",openapiGenerator:"7.26.0",
    note:"Compiled artifact; HTTP/DB/browser conformance must be tested independently",
  };
  writeFileSync(join(out,"protocolia-build.json"),JSON.stringify(metadata,null,2)+"\n");
  console.log("PROTOCOLIA_APP_BUILD_SUCCESS "+JSON.stringify({output:out,...metadata}));
}
try {
  if(["run","test"].includes(process.argv[2])){
    const {composeAction}=await import("./compose.mjs");
    await composeAction(process.argv[2],process.argv[3]);
    if(process.argv.length!==4)throw Error("Unexpected extra options");
  }else main();
}catch(e){
  console.error("PROTOCOLIA_APP_"+(process.argv[2]??"COMMAND").toUpperCase()+"_FAILED "+e.message);
  process.exitCode=1;
}
