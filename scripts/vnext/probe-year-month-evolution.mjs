// Independent release gate: compare actual before/after TypeSpec and emitted OpenAPI.
import assert from "node:assert/strict";
import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {diffContracts,validateOpenApiEvolution,additiveSql} from "../../packages/cli/regeneration.mjs";

const root=process.cwd(),fixture="examples/vnext/volunteer-evaluations";
const pattern="^[0-9]{4}-(0[1-9]|1[0-2])$";
const decoration="@pattern("+JSON.stringify(pattern)+")";
const scratch=mkdtempSync(join("examples","vnext",".ux5-before-"));
const json=(dir,name)=>JSON.parse(readFileSync(join(dir,"tsp-output",name),"utf8"));
try {
  cpSync(join(fixture,"tspconfig.yaml"),join(scratch,"tspconfig.yaml"));
  cpSync(join(fixture,"contracts"),join(scratch,"contracts"),{recursive:true});
  const source=readFileSync(join(scratch,"contracts/main.tsp"),"utf8");
  assert.equal(source.split(decoration).length-1,5);
  writeFileSync(join(scratch,"contracts/main.tsp"),source.replaceAll(decoration,""));
  const compiled=spawnSync(join(root,"node_modules/.bin/tsp"),["compile",scratch],
    {cwd:root,encoding:"utf8",timeout:90000});
  assert.equal(compiled.status,0,(compiled.stdout??"")+(compiled.stderr??""));
  const oldIr=json(scratch,"@protocolia/compiler/ir.json");
  const newIr=json(fixture,"@protocolia/compiler/ir.json");
  const oldOpenApi=json(scratch,"@typespec/openapi3/openapi.json");
  const newOpenApi=json(fixture,"@typespec/openapi3/openapi.json");
  const plan=diffContracts(oldIr,newIr);
  assert.equal(plan.compatible,true,JSON.stringify(plan.blockers));
  assert.deepEqual(plan.changes.map(c=>c.kind),["addPattern","addPattern"]);
  assert.deepEqual(plan.changes.map(c=>c.entity+"."+c.field.name).sort(),
    ["LeaveRecord.period","MonthlyEvaluation.period"]);
  const drift=validateOpenApiEvolution(oldOpenApi,newOpenApi,oldIr,newIr,plan);
  assert.deepEqual(drift,[],"Only declared pattern constraint changes are permissible");
  const sql=additiveSql(plan,newIr);
  if(process.env.PROTOCOLIA_UX5_SQL_OUT)
    writeFileSync(process.env.PROTOCOLIA_UX5_SQL_OUT,sql+"\n");
  assert.equal((sql.match(/ADD CONSTRAINT/g)||[]).length,2);
  assert.equal((sql.match(/VALIDATE CONSTRAINT/g)||[]).length,2);
  assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM|UPDATE |ALTER COLUMN/i);
  assert.match(sql,/NOT VALID;/);
  console.log("PROTOCOLIA_UX5_REAL_EVOLUTION_PASS "+JSON.stringify({
    patterns:plan.changes.map(c=>c.entity+"."+c.field.name),migrationChecks:2,
    originalBaselinePreserved:true,requiresTransactionalValidation:true
  }));
}finally{rmSync(scratch,{recursive:true,force:true});}
