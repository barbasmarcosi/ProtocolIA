import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {bundlePassport} from "../../packages/cli/passport-bundle.mjs";
import {sealApp,verifyApp} from "../../packages/cli/ownership.mjs";
import {verifyPassport} from "../../scripts/research/project-passport.mjs";

function ir(){
  return {irVersion:"vnext-a0.1",namespace:"KioskDomain",entities:[
    {name:"Product",publicIdentity:"sku",fields:[
      {name:"sku",type:"string",required:true,nullable:false,unique:true},
      {name:"quantity",type:"int32",required:true,nullable:false,min:0}
    ]}
  ],operations:[
    {name:"createProduct",entity:"Product",method:"POST",path:"/api/products",
      behavior:{kind:"create"},capability:"product.write"}
  ]};
}
function fixture(run){
  const temp=mkdtempSync(join(tmpdir(),"protocolia-bundled-passport-"));
  const app=join(temp,"generated");
  const inputs=join(temp,"input");
  try{
    // A minimal fake app is sufficient for testing the ownership boundary.
    // CI separately uses the actual TypeSpec and generated NestJS pipeline.
    mkdirSync(app);mkdirSync(inputs);
    writeFileSync(join(app,"protocolia-contract-ir.json"),JSON.stringify(ir()));
    writeFileSync(join(app,"protocolia-contract-openapi.json"),"{}");
    writeFileSync(join(app,"protocolia-build.json"),"{}");
    return run({temp,app,inputs});
  }finally{rmSync(temp,{recursive:true,force:true});}
}
const requirements=()=>({schemaVersion:"protocolia-requirements/v1",requirements:[
  {id:"K-01",text:"Products must persist",origin:"source_brief_unverified",
    evidenceRefs:["test-brief"],operations:["createProduct"]}
]});
const decisions=()=>({schemaVersion:"protocolia-decision-ledger/v0.1",
  authority:"SELF_DECLARED_UNVERIFIED",sourceSha256:"a".repeat(64),
  decisions:[{id:"K-Q01",question:"What refund policy?",classification:"material_business",
    state:"unresolved",affectsSupported:false,origin:"agent_assumption",evidenceRefs:[]}]});

test("opt-in Passport builds immutable source snapshots and seals every doc",()=>fixture(({app,inputs})=>{
  const req=join(inputs,"requirements.json"),dec=join(inputs,"decisions.json");
  writeFileSync(req,JSON.stringify(requirements()));
  writeFileSync(dec,JSON.stringify(decisions()));
  const output=bundlePassport(app,{requirements:req,decisions:dec});
  assert.equal(output.status,"GENERATED_PORTABLE_INTEGRITY_ONLY");
  assert.equal(output.requirementsProvided,true);
  assert.equal(output.decisionsProvided,true);
  const reqSnap=join(app,"protocolia-passport-inputs/requirements.json");
  const decSnap=join(app,"protocolia-passport-inputs/decisions.json");
  assert.deepEqual(readFileSync(req),readFileSync(reqSnap));
  assert.deepEqual(readFileSync(dec),readFileSync(decSnap));
  assert.equal(verifyPassport(join(app,"protocolia-contract-ir.json"),join(app,"passport"),reqSnap,decSnap).status,
    "PASS_PORTABLE_INTEGRITY_ONLY");
  assert.match(readFileSync(join(app,"passport/docs/domain/decisions.md"),"utf8"),/What refund policy/);
  sealApp(app);verifyApp(app);
  writeFileSync(req,JSON.stringify({...requirements(),requirements:[]}));
  // External files are no longer needed for verification of this app bundle.
  verifyApp(app);
  writeFileSync(join(app,"passport/docs/domain/entities.md"),"tampered");
  assert.throws(()=>verifyApp(app),/Managed files modified/);
}));

test("Passport is optional and cannot be replaced or silently changed",()=>fixture(({app})=>{
  assert.equal(bundlePassport(app).requirementsProvided,false);
  assert.equal(verifyPassport(join(app,"protocolia-contract-ir.json"),join(app,"passport")).status,
    "PASS_PORTABLE_INTEGRITY_ONLY");
  assert.throws(()=>bundlePassport(app),/replace existing/);
  sealApp(app);verifyApp(app);
  writeFileSync(join(app,"protocolia-contract-ir.json"),JSON.stringify({...ir(),namespace:"Another"}));
  assert.throws(()=>verifyApp(app),/Managed files modified/);
}));

test("rejects symlinked or invalid source evidence",()=>fixture(({app,inputs})=>{
  const req=join(inputs,"requirements.json"),link=join(inputs,"linked.json");
  writeFileSync(req,JSON.stringify(requirements()));symlinkSync(req,link);
  assert.throws(()=>bundlePassport(app,{requirements:link}),/Unsafe requirements input file/);
  assert.equal(existsSync(join(app,"passport")),false);
}));

test("unknown operations cannot be declared verified via bundled requirements",()=>fixture(({app,inputs})=>{
  const req=join(inputs,"requirements.json");
  const m=requirements();m.requirements[0].operations=["inventedOperation"];
  writeFileSync(req,JSON.stringify(m));
  assert.throws(()=>bundlePassport(app,{requirements:req}),/unknown mapped operation/);
}));

test("CLI refuses provenance args without explicit Passport opt-in",()=>{
  const cli=resolve("packages/cli/protocolia.mjs");
  const result=spawnSync(process.execPath,[cli,"build","/not-a-project",
    "--target","nestjs","--out","/tmp/protocolia-test-only",
    "--passport-requirements","/tmp/claims.json"],{encoding:"utf8"});
  assert.equal(result.status,1);
  assert.match(result.stderr,/Passport source options require explicit --passport/);
});
