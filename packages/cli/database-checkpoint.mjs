// Explicit read-only backup checkpoint for an existing local generated PostgreSQL
// Compose project. Never starts/stops a database, runs SQL DDL or performs restore.
import {spawnSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {closeSync,existsSync,openSync,readFileSync,readSync,renameSync,
  statSync,unlinkSync,writeFileSync,linkSync,fsyncSync} from "node:fs";
import {dirname,join,relative,resolve,sep} from "node:path";
import {verifyApp} from "./ownership.mjs";

const abort=message=>{throw Error("DB checkpoint refused: "+message);};
const projectPattern=/^[a-z][a-z0-9_-]{1,62}$/;
function boundedCommand(args,{cwd,stdin,stdout,timeout=120000}={}){
  const process=spawnSync("docker",args,{cwd,encoding:"utf8",timeout,
    maxBuffer:2*1024*1024,
    stdio:[stdin??"ignore",stdout??"pipe","pipe"]});
  if(process.error)abort("Docker unavailable: "+process.error.message);
  if(process.status!==0)abort("Docker operation failed: "+
    (process.stderr??"").slice(-450).replace(/[\r\n]+/g," ").trim());
  return (process.stdout??"").trim();
}
function fileHash(path){
  const sha=createHash("sha256"),fd=openSync(path,"r"),buffer=Buffer.allocUnsafe(1024*1024);
  try{
    let n=0;
    while((n=readSync(fd,buffer,0,buffer.length,null))>0)sha.update(buffer.subarray(0,n));
    return sha.digest("hex");
  }finally{closeSync(fd);}
}
function isContained(root,path){
  const rel=relative(root,path);
  return rel===""||(!rel.startsWith(".."+sep)&&rel!==".."&&!rel.startsWith(sep));
}
export function checkpointOptions(args){
  if(args.length!==7||args[1]!=="--project"||args[3]!=="--env-file"||args[5]!=="--out")
    abort("Usage: app:db:checkpoint -- <generated-dir> --project <compose-name> --env-file <env> --out <path.dump>");
  const [folder,,project,,environment,,destination]=args;
  if(!projectPattern.test(project))abort("Unsafe or missing Docker Compose project name");
  if(!destination.endsWith(".dump"))abort("Backup path must end with .dump");
  const dir=resolve(folder),env=resolve(environment),archive=resolve(destination);
  if(isContained(dir,archive))abort("Backup must be outside the generated application tree");
  if(archive===env)abort("Backup destination would overwrite credentials");
  if(!existsSync(env)||!statSync(env).isFile())abort("Explicit Compose environment file is missing");
  if(existsSync(archive)||existsSync(archive+".json"))
    abort("Backup archive or integrity manifest already exists; overwrite forbidden");
  return {dir,env,archive,project};
}
export function verifyCheckpoint(archiveName){
  const archive=resolve(archiveName),manifest=archive+".json";
  if(!existsSync(archive)||!existsSync(manifest))
    abort("Backup and integrity manifest are both required");
  const meta=JSON.parse(readFileSync(manifest,"utf8")),f=statSync(archive);
  if(!f.isFile()||f.size<32||(f.mode&0o077)!==0)
    abort("Backup is incomplete, unsafe or accessible by other local users");
  if(meta.version!==1||meta.format!=="pg_dump-custom"||
     meta.archiveSha256!==fileHash(archive)||meta.archiveBytes!==f.size||
     !["nestjs","modular-spring"].includes(meta.target))
    abort("Backup manifest checksum, size or format differs from archive");
  const fd=openSync(archive,"r");let magic;
  try{const b=Buffer.alloc(5);readSync(fd,b,0,5,0);magic=b.toString("ascii");}
  finally{closeSync(fd);}
  if(magic!=="PGDMP")abort("Not a PostgreSQL custom-format archive");
  console.log("PROTOCOLIA_DB_CHECKPOINT_VERIFY_PASS "+JSON.stringify({
    archive,sha256:meta.archiveSha256,bytes:meta.archiveBytes,target:meta.target
  }));
  return meta;
}
export function createCheckpoint(args){
  const {dir,env,archive,project}=checkpointOptions(args);
  const seal=verifyApp(dir);
  const build=JSON.parse(readFileSync(join(dir,"protocolia-build.json"),"utf8"));
  if(!["nestjs","modular-spring"].includes(build.target)||
     !seal.files["compose.yaml"]||!seal.files["protocolia-contract-ir.json"])
    abort("Generated app missing a sealed Compose/contract and supported target");
  const compose=["compose","--project-name",project,"--env-file",env];
  boundedCommand([...compose,"config","--quiet"],{cwd:dir,timeout:20000});
  const db=boundedCommand([...compose,"ps","--quiet","db"],{cwd:dir,timeout:20000});
  if(!/^[a-f0-9]{12,64}$/i.test(db))
    abort("Expected a single already-running database in the explicitly named project");
  boundedCommand([...compose,"exec","-T","db","pg_isready","-U","protocolia","-d","protocolia"],
    {cwd:dir,timeout:15000});
  const temporary=join(dirname(archive),".protocolia-backup-"+randomBytes(10).toString("hex")+".tmp");
  let installed=false;
  try{
    const fd=openSync(temporary,"wx",0o600);
    try{
      boundedCommand([...compose,"exec","-T","db","pg_dump",
        "-U","protocolia","-d","protocolia","--format=custom","--no-owner","--no-acl"],
        {cwd:dir,stdout:fd,timeout:600000});
      fsyncSync(fd);
    }finally{closeSync(fd);}
    if(statSync(temporary).size<32)abort("pg_dump emitted an empty/incomplete archive");
    // Verify the PostgreSQL TOC using pg_restore. Does not claim that every row
    // is restorable: use the independently rehearsed restore test before upgrades.
    const restoreFd=openSync(temporary,"r");
    try{
      boundedCommand([...compose,"exec","-T","db","pg_restore","--list"],
        {cwd:dir,stdin:restoreFd,stdout:"ignore",timeout:120000});
    }finally{closeSync(restoreFd);}
    const hash=fileHash(temporary),size=statSync(temporary).size;
    const metadata={version:1,format:"pg_dump-custom",target:build.target,
      contractSha256:build.contractSha256,
      archiveSha256:hash,archiveBytes:size,
      composeProject:project,databaseContainerId:db,
      createdAt:new Date().toISOString(),
      note:"Consistent pg_dump snapshot; verify full restoration into an isolated database before any production upgrade."};
    // Hard links never replace a pre-existing destination, unlike rename().
    linkSync(temporary,archive);installed=true;unlinkSync(temporary);
    try{
      writeFileSync(archive+".json",JSON.stringify(metadata,null,2)+"\n",
        {mode:0o600,flag:"wx"});
    }catch(error){unlinkSync(archive);installed=false;throw error;}
    verifyCheckpoint(archive);
    console.log("PROTOCOLIA_DB_CHECKPOINT_CREATED "+JSON.stringify({
      archive,sha256:hash,bytes:size,project,target:build.target,
      caution:"Backup is not a verified restore until rehearsed on an isolated DB."
    }));
    return metadata;
  }catch(error){
    if(!installed&&existsSync(temporary))unlinkSync(temporary);
    throw error;
  }
}
