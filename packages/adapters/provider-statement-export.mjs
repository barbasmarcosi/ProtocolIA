// Emit an operator-invoked READ-ONLY psql export from the canonical TypeSpec
// receipt binding. Both generated targets consume the same binding; the file
// is not executed during generation, application boot or schema migrations.
// No provider transaction ID exists in the contract: it MUST NOT be inferred
// from synthetic webhook event IDs. Operator supplies a separate crosswalk.
export function providerInternalStatementExportSql(exactReconciliations) {
  if (!(exactReconciliations instanceof Map))
    throw Error("Missing canonical exact ledger plans");
  const plans=[...exactReconciliations.values()].filter(p=>p.unverifiedProofField);
  if(plans.length===0)return null;
  if(plans.length!==1)throw Error("Ambiguous exact ledger for statement export");
  const b=plans[0].providerCandidate;
  const safe=value=>typeof value==="string" && /^[a-z][a-z0-9_]*$/.test(value);
  if(!b || ![b.childTable,b.receiptColumn,b.referenceColumn,
    b.amountColumn,b.stateColumn,b.proofColumn].every(safe) ||
    b.postedState!=="posted" ||
    !Number.isInteger(b.scale) || b.scale<0 || b.scale>6)
    throw Error("Unsupported or unsafe statement export binding");
  return [
    "-- Generated operator-only receipt snapshot; NEVER executed during app boot.",
    "-- Requires psql -X -v ON_ERROR_STOP=1 -v currency=ARS -At -f <this-file>.",
    "-- Use an independently authorized READ-ONLY database identity.",
    "-- No provider transaction identity is inferred from webhook event IDs.",
    "-- The emitted proofState remains unverified; never declare bank settlement.",
    "SELECT COALESCE(jsonb_agg(jsonb_build_object(",
    "  'receiptId',p."+b.receiptColumn+"::text,",
    "  'orderId',p."+b.referenceColumn+"::text,",
    "  'amount',p."+b.amountColumn+"::text,",
    "  'currency',:'currency',",
    "  'status',p."+b.stateColumn+"::text,",
    "  'proofState',p."+b.proofColumn+"::text",
    "  ) ORDER BY p."+b.receiptColumn+"::text),'[]'::jsonb)::text",
    "FROM "+b.childTable+" p;",
    ""
  ].join("\n");
}
