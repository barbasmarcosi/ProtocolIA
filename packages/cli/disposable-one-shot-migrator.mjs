// v1.1q: Same previously staged immutable image, two separate lifetimes:
// privileged one-shot migrator, then non-superuser HTTP app without its secret.
// This prepares only a disposable Compose overlay; it NEVER deploys.
import {existsSync,lstatSync,writeFileSync} from "node:fs";
import {resolve,dirname,relative,isAbsolute,sep} from "node:path";
import {ephemeralCutoverProject} from "./cutover-recovery.mjs";
const reject=m=>{throw Error("Disposable one-shot migrator refused: "+m);};
const quote=v=>JSON.stringify(v);
export function oneShotOverlay(imageId,target){
  if(!/^sha256:[0-9a-f]{64}$/.test(imageId))
    reject("Require previously staged exact Docker image ID, never mutable tag");
  if(!["nestjs","modular-spring"].includes(target))
    reject("Only supported generated contract adapters allowed");
  const jdbc=target==="nestjs"?"postgresql://db:5432/protocolia":
    "jdbc:postgresql://db:5432/protocolia";
  const handoff=imageId.slice(7);
  return [
    "services:",
    "  app:",
    "    image: "+imageId,
    "    pull_policy: never",
    "    build: !reset null",
    "    environment:",
    "      PROTOCOLIA_EXECUTION_MODE: runtime",
    "      PROTOCOLIA_MIGRATION_HANDOFF_ID: "+handoff,
    "      PROTOCOLIA_MIGRATION_FAILPOINT: !reset null",
    "      PROTOCOLIA_MIGRATION_JDBC_USER: !reset null",
    "      PROTOCOLIA_MIGRATION_JDBC_PASSWORD: !reset null",
    "  migrate:",
    "    image: "+imageId,
    "    pull_policy: never",
    "    environment:",
    "      PROTOCOLIA_EXECUTION_MODE: migrate",
    "      PROTOCOLIA_MIGRATION_HANDOFF_ID: "+handoff,
    '      PROTOCOLIA_HANDOFF_RUNTIME_USER: ${PROTOCOLIA_RUNTIME_DB_USER:-protocolia}',
    "      PROTOCOLIA_JDBC_URL: "+jdbc,
    "      PROTOCOLIA_JDBC_USER: protocolia",
    "      PROTOCOLIA_JDBC_PASSWORD: \${PROTOCOLIA_DB_PASSWORD:?set PROTOCOLIA_DB_PASSWORD}",
    "      PROTOCOLIA_AUTH_MODE: demo",
    "      PROTOCOLIA_ALLOW_DEMO_AUTH: "+quote("true"),
    "      PROTOCOLIA_MANAGER_USERNAME: manager",
    "      PROTOCOLIA_MANAGER_PASSWORD: \${PROTOCOLIA_MANAGER_PASSWORD:?set PROTOCOLIA_MANAGER_PASSWORD}",
    "      PROTOCOLIA_READER_USERNAME: reader",
    "      PROTOCOLIA_READER_PASSWORD: \${PROTOCOLIA_READER_PASSWORD:?set PROTOCOLIA_READER_PASSWORD}",
    ""
  ].join("\n");
}
export function oneShotOverlayOptions(args){
  if(args.length!==9||args[1]!=="--target"||args[3]!=="--image"||
     args[5]!=="--project"||args[7]!=="--out")
    reject("Usage: <generated-app> --target nestjs|modular-spring --image sha256:... --project pia_ckpt_<hex> --out <new-private.yaml>");
  const [dir,,target,,imageId,,project,,out]=args;
  ephemeralCutoverProject(project);
  const app=resolve(dir),dest=resolve(out);
  const rel=relative(app,dest);
  if(rel===""||(rel!==".."&&!rel.startsWith(".."+sep)&&!isAbsolute(rel))||
     !dest.endsWith(".yaml")||!existsSync(dirname(dest))||existsSync(dest))
    reject("Overlay must be newly created outside generated app");
  return {target,imageId,project,dest,contents:oneShotOverlay(imageId,target)};
}
export function writeOneShotOverlay(args){
  const o=oneShotOverlayOptions(args);
  writeFileSync(o.dest,o.contents,{mode:0o600,flag:"wx"});
  const stat=lstatSync(o.dest);
  if(!stat.isFile()||(stat.mode&0o077)!==0)reject("Owner-only YAML file required");
  console.log("PROTOCOLIA_V11_ONE_SHOT_OVERLAY_READY "+JSON.stringify({
    target:o.target,imageId:o.imageId,project:o.project,
    migrationsOneShot:true,httpWithoutPrivilegedSqlSecret:true
  }));
  return o;
}
