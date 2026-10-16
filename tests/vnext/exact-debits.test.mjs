import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {compileExactDebits,compileExactReversals} from "../../packages/adapters/exact-debit.mjs";
const root="examples/vnext/exact-debits";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const ir=JSON.parse(readFileSync(join(root,"tsp-output/@protocolia/compiler/ir.json"),"utf8"));
test("typed TypeSpec debit becomes exact, authorized canonical IR and adapter plan",()=>{
  const op=ir.operations.find(x=>x.name==="createCharge");
  assert.deepEqual(op.behavior.debitExact,{stockEntity:"Wallet",availableField:"available",referenceField:"walletCode",quantityField:"amount"});
  const wallet=ir.entities.find(x=>x.name==="Wallet");
  const charge=ir.entities.find(x=>x.name==="Charge");
  assert.equal(wallet.fields.find(x=>x.name==="available").decimal.scale,2);
  assert.equal(charge.fields.find(x=>x.name==="amount").decimal.min,"0.01");
  const plan=compileExactDebits(ir).get("createCharge");
  assert.deepEqual(plan,{balanceTable:"wallet",balanceKey:"wallet_code",balanceColumn:"available",referenceField:"walletCode",amountField:"amount",parentWriteCapability:"wallets.write",maxBalance:"9999999999999999999999.99"});
  assert.deepEqual(compileExactReversals(ir).get("reverseCharge"),{...plan,referenceColumn:"wallet_code",amountColumn:"amount"});
  const reverse=ir.operations.find(x=>x.name==="reverseCharge");
  assert.deepEqual(reverse.behavior.reverseExact,op.behavior.debitExact);
  assert.deepEqual([reverse.behavior.field,reverse.behavior.from,reverse.behavior.to],["status","posted","reversed"]);
  assert.deepEqual(reverse.behavior.audit,["status"]);
  assert.equal(op.behavior.audit?.[0],"amount");
});
test("corrupted transaction metadata fails closed in both generators",()=>{
  const edits=[
    x=>{x.operations.find(o=>o.name==="createCharge").behavior.debitExact.stockEntity="Wallet;drop table x";},
    x=>{x.operations.find(o=>o.name==="createCharge").behavior.debitExact.availableField="name";},
    x=>{x.operations.find(o=>o.name==="createCharge").behavior.debitExact.quantityField="walletCode";},
    x=>{x.entities.find(e=>e.name==="Charge").fields.find(f=>f.name==="amount").decimal.min="0";},
    x=>{x.entities.find(e=>e.name==="Wallet").fields.find(f=>f.name==="available").decimal.scale=3;}
  ];
  for(const mutate of edits){
    const candidate=structuredClone(ir);mutate(candidate);
    assert.throws(()=>compileExactDebits(candidate),/Invalid exact debit transaction/);
  }
});
test("corrupted exact reversal plans fail closed",()=>{
  const edits=[
    x=>{x.operations.find(o=>o.name==="reverseCharge").behavior.reverseExact.availableField="bad;drop";},
    x=>{x.operations.find(o=>o.name==="reverseCharge").behavior.reverseExact.quantityField="status";},
    x=>{x.operations.find(o=>o.name==="reverseCharge").behavior.audit=[];},
    x=>{x.operations.find(o=>o.name==="reverseCharge").behavior.to="posted";},
    x=>{x.operations.find(o=>o.name==="reverseCharge").behavior.from="reversed";},
    x=>{x.operations.find(o=>o.name==="createCharge").behavior.debitExact=undefined;},
    x=>{x.operations.push({...x.operations.find(o=>o.name==="reverseCharge"),name:"secondReverse"});},
    x=>{x.operations.push({...x.operations.find(o=>o.name==="reverseCharge"),name:"deleteCharge",behavior:{kind:"delete"}});}
  ];
  for(const mutate of edits){const candidate=structuredClone(ir);mutate(candidate);
    assert.throws(()=>compileExactReversals(candidate),/Invalid exact reversal lifecycle|Invalid exact debit transaction/);
  }
});
test("unbound, negative, mixed scale and unprotected request mutations fail TypeSpec compilation",()=>{
  const cases=[
    ['@debitExact("Wallet","available","walletCode","amount")','@debitExact("Wallet","name","walletCode","amount")'],
    ['@debitExact("Wallet","available","walletCode","amount")','@debitExact("Wallet","available","chargeNumber","amount")'],
    ['@debitExact("Wallet","available","walletCode","amount")','@debitExact("Missing","available","walletCode","amount")'],
    ['@exactDecimal(24,2,"0.01")','@exactDecimal(24,2,"0")'],
    ['@exactDecimal(24,2,"0.01")','@exactDecimal(24,3,"0.001")'],
    ['@encode(string) @exactDecimal(24,2,"0.01") amount: decimal;','@encode(string) @exactDecimal(24,2,"0.01") amount?: decimal;'],
    ['@reverseExact("Wallet","available","walletCode","amount")','@reverseExact("Wallet","name","walletCode","amount")'],
    ['@reverseExact("Wallet","available","walletCode","amount")','@reverseExact("Wallet","available","chargeNumber","amount")'],
    ['@reverseExact("Wallet","available","walletCode","amount")','@reverseExact("Missing","available","walletCode","amount")'],
    ['@transition("posted","reversed")','@transition("unknown","reversed")'],
    ['@audit("status") @capability("charges.write")','@capability("charges.write")']
  ];
  for(const [from,to] of cases){
    const temp=mkdtempSync(join("examples","vnext",".exact-debit-negative-"));
    try{
      cpSync(join(root,"tspconfig.yaml"),join(temp,"tspconfig.yaml"));
      cpSync(join(root,"contracts"),join(temp,"contracts"),{recursive:true});
      let replaced=source.replace(from,to);assert.notEqual(replaced,source);
      writeFileSync(join(temp,"contracts/main.tsp"),replaced);
      const run=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",temp],{encoding:"utf8",timeout:90000});
      assert.notEqual(run.status,0,"Invalid exact debit mutation compiled: "+to);
      assert.match((run.stdout??"")+(run.stderr??""),/protocolia-invalid-exact-debit|protocolia-decimal-request-mismatch|protocolia-invalid-exact-reversal|protocolia-exact-reversal-lifecycle/i);
    }finally{rmSync(temp,{recursive:true,force:true});}
  }
});
