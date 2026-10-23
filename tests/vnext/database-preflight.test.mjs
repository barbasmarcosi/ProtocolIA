import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {preflightOptions} from "../../packages/cli/database-preflight.mjs";

function fixture(){
  const root=mkdtempSync(join(tmpdir(),"pia-preflight-options-"));
  const project=join(root,"source"),app=join(root,"application");
  mkdirSync(project);mkdirSync(app);
  writeFileSync(join(project,"tspconfig.yaml"),"emit: []\n");
  writeFileSync(join(app,"protocolia-build.json"),JSON.stringify({target:"nestjs"}));
  return {root,project,app};
}
test("v1.1 offline preflight requires a new report outside source and app",()=>{
  const f=fixture(),dump=join(f.root,"snapshot.dump"),report=join(f.root,"result.json");
  const args=[f.project,f.app,"--checkpoint",dump,"--report",report];
  assert.deepEqual(preflightOptions(args),{
    project:f.project,dir:f.app,archive:dump,report
  });
  const rejected=[
    [...args.slice(0,5),join(f.app,"report.json")],
    [...args.slice(0,5),join(f.project,"report.json")],
    [...args.slice(0,5),join(f.root,"missing","report.json")],
    [f.project,f.app,"--checkpoint",report,"--report",report],
    [f.project,f.app,"--checkpoint",join(f.root,"bad.sql"),"--report",report],
    [f.project,f.app,"--checkpoint",dump,"--wrong",report],
  ];
  writeFileSync(join(f.root,"present.json"),"{}");
  rejected.push([...args.slice(0,5),join(f.root,"present.json")]);
  for(const unsafe of rejected)
    assert.throws(()=>preflightOptions(unsafe),/DB preflight refused/);
});
test("v1.1 offline preflight does not treat a missing app or project as safe",()=>{
  const f=fixture(),a=[f.project,f.app,"--checkpoint",join(f.root,"snapshot.dump"),
    "--report",join(f.root,"report.json")];
  assert.throws(()=>preflightOptions([join(f.root,"missing"),...a.slice(1)]),
    /DB preflight refused/);
  assert.throws(()=>preflightOptions([a[0],join(f.root,"missing"),...a.slice(2)]),
    /DB preflight refused/);
});
