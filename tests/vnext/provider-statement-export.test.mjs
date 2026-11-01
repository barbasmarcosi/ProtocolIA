import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {providerInternalStatementExportSql as generate} from "../../packages/adapters/provider-statement-export.mjs";
const plans=()=>new Map([["one",{unverifiedProofField:"providerSettlementState",
  providerCandidate:{childTable:"payment",receiptColumn:"receipt",
    referenceColumn:"order_number",amountColumn:"amount",
    stateColumn:"status",proofColumn:"provider_settlement_state",
    postedState:"posted",scale:2}}]]);
test("canonical statement exporter is read-only and emits the CLI's exact DTO fields",()=>{
  const sql=generate(plans());
  assert.match(sql,/SELECT COALESCE\(jsonb_agg\(/);
  assert.match(sql,/'receiptId',p.receipt::text/);
  assert.match(sql,/'orderId',p.order_number::text/);
  assert.match(sql,/'amount',p.amount::text/);
  assert.match(sql,/'status',p.status::text/);
  assert.match(sql,/'proofState',p.provider_settlement_state::text/);
  assert.match(sql,/'currency',:'currency'/);
  assert.match(sql,/ORDER BY p.receipt::text/);
  assert.match(sql,/FROM payment p/);
  assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|DO|EXECUTE)\b/i);
  assert.doesNotMatch(sql,/transactionId|event_id|provider_id/i,
    "Webhook event ID cannot stand in for a provider transaction ID");
  assert.equal(generate(plans()),sql,"Output must be deterministic");
});
test("canonical exporter requires exactly one safe bounded ledger, not guesses",()=>{
  assert.equal(generate(new Map()),null);
  assert.throws(()=>generate(null),/Missing canonical/);
  let p=plans();p.set("two",{...p.get("one")});
  assert.throws(()=>generate(p),/Ambiguous exact/);
  p=plans();p.get("one").providerCandidate.childTable="payment;DROP TABLE x";
  assert.throws(()=>generate(p),/Unsupported or unsafe/);
  p=plans();p.get("one").providerCandidate.scale=7;
  assert.throws(()=>generate(p),/Unsupported or unsafe/);
});
test("both independently generated adapters include the same canonical export",()=>{
  for(const path of [
    "packages/adapters/modular/generate.mjs",
    "packages/adapters/nest/generate.mjs"
  ]) {
    const source=readFileSync(path,"utf8");
    assert.match(source,/import \{providerInternalStatementExportSql\} from "\.\.\/provider-statement-export\.mjs"/);
    assert.match(source,/write\("protocolia-reconciliation-internal-export\.sql",providerInternalStatementExportSql\(exactReconciliations\)\)/);
  }
});
