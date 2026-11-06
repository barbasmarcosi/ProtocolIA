// R3 opt-in: bundle a deterministic Project Passport with a generated app.
// This creates documentation, not customer approval, runtime authorization or test evidence.
import {existsSync,lstatSync,readFileSync,readdirSync,mkdirSync,writeFileSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {generatePassport,verifyPassport} from "../../scripts/research/project-passport.mjs";
import {snapshotContractSource} from "./contract-source-snapshot.mjs";

function checkedInput(path,label){
  const full=resolve(path);
  const stat=lstatSync(full);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>=4194304)
    throw Error("Unsafe "+label+" input file");
  return readFileSync(full);
}

export function bundlePassport(out,{requirements,decisions,project,contractSha256}={}){
  const root=resolve(out);
  if(!existsSync(root)||!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())
    throw Error("Generated application directory required");
  const names=new Set(readdirSync(root));
  if(names.has("passport")||names.has("protocolia-passport-inputs")||
     names.has("protocolia-passport-verify.mjs")||
     names.has("protocolia-contract-source")||
     names.has("protocolia-contract-source.lock.json")||
     names.has("protocolia-contract-source-verify.mjs")||
     names.has("PROJECT_HANDOFF.md"))
    throw Error("Refusing to replace existing Passport or source files");
  const ir=join(root,"protocolia-contract-ir.json");
  checkedInput(ir,"generated IR");
  // Read both source files *before* writing to protect against aliases and
  // dangling symlinks; the Passport validator subsequently checks semantics.
  const reqBytes=requirements?checkedInput(requirements,"requirements"):null;
  const decisionBytes=decisions?checkedInput(decisions,"decisions"):null;
  // R4 prerequisite: no source TypeSpec means the documented application
  // cannot be rebuilt from the handoff package. Freeze the exact compiler
  // inputs and verify the CLI's original pre-build contract digest.
  if(typeof project!=="string"||typeof contractSha256!=="string")
    throw Error("Passport requires authoritative TypeSpec project and build digest");
  const contractSource=snapshotContractSource(project,
    join(root,"protocolia-contract-source"),contractSha256);
  let reqPath,decisionPath;
  if(reqBytes||decisionBytes){
    const inputs=join(root,"protocolia-passport-inputs");
    mkdirSync(inputs);
    if(reqBytes){
      reqPath=join(inputs,"requirements.json");
      writeFileSync(reqPath,reqBytes,{flag:"wx"});
    }
    if(decisionBytes){
      decisionPath=join(inputs,"decisions.json");
      writeFileSync(decisionPath,decisionBytes,{flag:"wx"});
    }
  }
  const dest=join(root,"passport");
  const generated=generatePassport(ir,dest,reqPath,decisionPath);
  const verified=verifyPassport(ir,dest,reqPath,decisionPath);
  if(generated.irSha256!==verified.irSha256)
    throw Error("Inconsistent Project Passport generated IR");
  // The verifier has only Node built-in dependencies. Include the exact
  // implementation used to check the bundle so the consumer can verify docs
  // without a ProtocolIA checkout; the outer app seal covers this tool too.
  const verifier=resolve(dirname(fileURLToPath(import.meta.url)),
    "../../scripts/research/project-passport.mjs");
  writeFileSync(join(root,"protocolia-passport-verify.mjs"),
    checkedInput(verifier,"Passport verifier"),{flag:"wx"});
  const sourceVerifier=resolve(dirname(fileURLToPath(import.meta.url)),
    "contract-source-snapshot.mjs");
  writeFileSync(join(root,"protocolia-contract-source-verify.mjs"),
    checkedInput(sourceVerifier,"TypeSpec source verifier"),{flag:"wx"});
  writeFileSync(join(root,"PROJECT_HANDOFF.md"),[
    "# ProtocolIA application handoff","",
    "This folder contains generated code, canonical contract bytes, and an",
    "IR-derived Passport. Local SHA-256 consistency is NOT authenticated approval.","",
    "## Begin without any prior chats","",
    "1. Read passport/PROJECT_PASSPORT.md and passport/AGENTS.md.",
    "2. Verify the TypeSpec source: node protocolia-contract-source-verify.mjs verify protocolia-contract-source protocolia-contract-source.lock.json",
    "3. Verify documents: node protocolia-passport-verify.mjs verify --ir protocolia-contract-ir.json --out passport",
    "4. For any bundled declarations, pass --requirements protocolia-passport-inputs/requirements.json and/or --decisions protocolia-passport-inputs/decisions.json to the Passport verifier.",
    "5. Inspect protocolia-contract-source/contracts/*.tsp and tspconfig.yaml.",
    "6. Copy the contract-source folder to a separate new project, then use a",
    "   compatible pinned ProtocolIA toolchain to rebuild and test both targets.",
    "7. Do NOT alter this sealed generated tree in place or call a build a safe",
    "   database migration. Keep business questions UNKNOWN until approved.",
    "8. Independently verify HTTP, PostgreSQL, browser, data preservation and",
    "   migration/rollback before accepting a change or deployment.","",
    "No production IAM, legal compliance, settlement or independent agent",
    "performance is attested by these artifacts.",""
  ].join("\\n"),{flag:"wx"});
  return {
    status:"GENERATED_PORTABLE_INTEGRITY_ONLY",
    irSha256:verified.irSha256,
    requirementsProvided:!!reqPath,
    decisionsProvided:!!decisionPath,
    files:verified.files,
    contractSource
  };
}
