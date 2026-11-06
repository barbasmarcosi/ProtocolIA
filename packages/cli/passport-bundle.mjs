// R3 opt-in: bundle a deterministic Project Passport with a generated app.
// This creates documentation, not customer approval, runtime authorization or test evidence.
import {existsSync,lstatSync,readFileSync,readdirSync,mkdirSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {generatePassport,verifyPassport} from "../../scripts/research/project-passport.mjs";

function checkedInput(path,label){
  const full=resolve(path);
  const stat=lstatSync(full);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>=4194304)
    throw Error("Unsafe "+label+" input file");
  return readFileSync(full);
}

export function bundlePassport(out,{requirements,decisions}={}){
  const root=resolve(out);
  if(!existsSync(root)||!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())
    throw Error("Generated application directory required");
  const names=new Set(readdirSync(root));
  if(names.has("passport")||names.has("protocolia-passport-inputs"))
    throw Error("Refusing to replace existing Passport files");
  const ir=join(root,"protocolia-contract-ir.json");
  checkedInput(ir,"generated IR");
  // Read both source files *before* writing to protect against aliases and
  // dangling symlinks; the Passport validator subsequently checks semantics.
  const reqBytes=requirements?checkedInput(requirements,"requirements"):null;
  const decisionBytes=decisions?checkedInput(decisions,"decisions"):null;
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
  return {
    status:"GENERATED_PORTABLE_INTEGRITY_ONLY",
    irSha256:verified.irSha256,
    requirementsProvided:!!reqPath,
    decisionsProvided:!!decisionPath,
    files:verified.files
  };
}
