import assert from "node:assert/strict";
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join,resolve} from "node:path";

const original=resolve("examples/vnext/equipment-inspections");
const variant=resolve("examples/vnext/a4-contract-evolution-test");
const output=resolve("dist/relations-evolved");
mkdirSync(join(variant,"contracts"),{recursive:true});
copyFileSync(join(original,"tspconfig.yaml"),join(variant,"tspconfig.yaml"));
let contract=readFileSync(join(original,"contracts/main.tsp"),"utf8");
contract=contract.replace('@view("Equipos")','@view("Equipos auditados")');
const marker='    @minLength(1) @maxLength(160)\n    notes: string;';
assert.equal(contract.split(marker).length-1,1,"Inspection entity field required");
contract=contract.replace(marker,'    checkedAt?: utcDateTime | null;\n'+marker);
const requestMarker='    @minLength(1) @maxLength(160) notes: string;';
assert.equal(contract.split(requestMarker).length-1,1,"Inspection request field required");
contract=contract.replace(requestMarker,'    checkedAt?: utcDateTime | null;\n'+requestMarker);
writeFileSync(join(variant,"contracts/main.tsp"),contract);
const result=spawnSync(process.execPath,[
  "packages/cli/protocolia.mjs","build",variant,
  "--target","modular-spring","--out",output
],{stdio:"inherit",timeout:600000});
if(result.error)throw result.error;
assert.equal(result.status,0,"Clean regeneration from changed contract must compile");
const ir=JSON.parse(readFileSync(join(variant,"tsp-output/@protocolia/compiler/ir.json"),"utf8"));
const ui=JSON.parse(readFileSync(join(output,"src/main/resources/static/protocolia-ui.json"),"utf8"));
const sql=readFileSync(join(output,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
const schema=JSON.parse(readFileSync(join(variant,"tsp-output/@typespec/openapi3/openapi.json"),"utf8"));
assert.equal(ir.entities.find(e=>e.name==="Equipment").view,"Equipos auditados");
assert.equal(ui.resources[0].view,"Equipos auditados");
const inspection=ui.resources.find(r=>r.entity.name==="Inspection");
assert.ok(inspection.entity.fields.some(f=>f.name==="checkedAt"&&!f.required&&f.nullable));
assert.match(sql,/checked_at TIMESTAMP WITH TIME ZONE/);
assert.ok(JSON.stringify(schema).includes('"checkedAt"'));
assert.ok(existsSync(join(output,"target/modular-generated-0.0.1.jar")));
console.log("A4_EVOLUTION_CLEAN_TYPE_SPEC_TO_UI_OPENAPI_SQL_JAR_PASS");
