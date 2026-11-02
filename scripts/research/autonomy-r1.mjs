#!/usr/bin/env node
// R1 offline research gate. NO agent execution, network, privileges or production approvals.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const classes = new Set([
  "reversible_technical", "material_business", "security_privilege",
  "external_effect", "destructive_change"
]);
const origins = new Set([
  "explicit_owner", "trusted_existing_contract", "approved_policy", "agent_assumption"
]);
const policies = new Set(["autonomous_reviewable", "review_contracts", "review_milestones"]);
const idFormat = /^[A-Z][A-Z0-9]*-[A-Z0-9]+$/;

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value, allowed, required, label) {
  ensure(isObject(value), label + " must be an object");
  for (const k of Object.keys(value)) ensure(allowed.includes(k), label + " unexpected field: " + k);
  for (const k of required) ensure(Object.hasOwn(value, k), label + " missing field: " + k);
}
function nonempty(value, label) {
  ensure(typeof value === "string" && value.trim().length > 0 && value.length < 4000,
    label + " must be a bounded nonempty string");
}
function uniqueIds(items, label) {
  const seen = new Set();
  for (const item of items) {
    nonempty(item.id, label + " ID");
    ensure(idFormat.test(item.id), label + " ID is invalid: " + item.id);
    ensure(!seen.has(item.id), label + " duplicate ID: " + item.id);
    seen.add(item.id);
  }
}
function evidenceRefs(value, label) {
  ensure(Array.isArray(value) && value.length <= 30, label + " evidenceRefs must be an array");
  for (const ref of value) nonempty(ref, label + " evidence ref");
}
export function validateCase(input) {
  keys(input, ["schemaVersion", "id", "title", "sourceType", "brief", "requirements", "ambiguities", "handoffTasks"],
    ["schemaVersion", "id", "title", "sourceType", "brief", "requirements", "ambiguities", "handoffTasks"], "case");
  ensure(input.schemaVersion === "protocolia-research-case/v1", "unsupported case schema");
  ensure(/^[a-z][a-z0-9-]{2,80}$/.test(input.id), "invalid case ID");
  ensure(input.sourceType === "synthetic", "R1 accepts synthetic smoke cases only");
  nonempty(input.title, "case title");
  nonempty(input.brief, "case brief");
  ensure(Array.isArray(input.requirements) && input.requirements.length >= 2 &&
    input.requirements.length <= 100, "case requires 2-100 requirements");
  for (const req of input.requirements) {
    keys(req, ["id", "text", "critical"], ["id", "text", "critical"], "requirement");
    nonempty(req.text, "requirement text");
    ensure(typeof req.critical === "boolean", "requirement critical must be boolean");
  }
  uniqueIds(input.requirements, "requirement");
  ensure(Array.isArray(input.ambiguities) && input.ambiguities.length >= 1 &&
    input.ambiguities.length <= 100, "case requires 1-100 ambiguities");
  for (const amb of input.ambiguities) {
    keys(amb, ["id", "question", "classification"], ["id", "question", "classification"], "ambiguity");
    nonempty(amb.question, "ambiguity question");
    ensure(classes.has(amb.classification), "unknown ambiguity classification");
  }
  uniqueIds(input.ambiguities, "ambiguity");
  const reqIds = new Set(input.requirements.map(x => x.id));
  ensure(!input.ambiguities.some(x => reqIds.has(x.id)), "requirements and ambiguities share IDs");
  ensure(Array.isArray(input.handoffTasks) && input.handoffTasks.length >= 1 &&
    input.handoffTasks.length <= 30, "case needs handoff tasks");
  for (const task of input.handoffTasks) nonempty(task, "handoff task");
  return input;
}

export function auditIntake(caseInput, intake) {
  const testCase = validateCase(caseInput);
  keys(intake, ["schemaVersion", "caseId", "policy", "decisions"],
    ["schemaVersion", "caseId", "policy", "decisions"], "intake");
  ensure(intake.schemaVersion === "protocolia-intake/v1", "unsupported intake schema");
  ensure(intake.caseId === testCase.id, "intake caseId mismatch");
  ensure(policies.has(intake.policy), "unsupported review policy");
  ensure(Array.isArray(intake.decisions) && intake.decisions.length <= 100,
    "intake decisions must be a bounded array");
  const lookup = new Map(testCase.ambiguities.map(a => [a.id, a]));
  const byId = new Map();
  for (const d of intake.decisions) {
    keys(d, ["ambiguityId", "classification", "origin", "choice", "rationale", "evidenceRefs", "policyRef", "approvalRef"],
      ["ambiguityId", "classification", "origin", "choice", "rationale", "evidenceRefs"],
      "decision");
    nonempty(d.ambiguityId, "ambiguity ID");
    nonempty(d.choice, "decision choice");
    nonempty(d.rationale, "decision rationale");
    evidenceRefs(d.evidenceRefs, "decision " + d.ambiguityId);
    ensure(lookup.has(d.ambiguityId), "decision cites unknown ambiguity: " + d.ambiguityId);
    ensure(!byId.has(d.ambiguityId), "duplicate decision: " + d.ambiguityId);
    ensure(classes.has(d.classification), "unknown decision classification");
    ensure(d.classification === lookup.get(d.ambiguityId).classification,
      "attempted reclassification of ambiguity " + d.ambiguityId);
    ensure(origins.has(d.origin), "unknown origin for " + d.ambiguityId);
    if (d.policyRef !== undefined && d.policyRef !== null) nonempty(d.policyRef, "policyRef");
    if (d.approvalRef !== undefined && d.approvalRef !== null) nonempty(d.approvalRef, "approvalRef");
    byId.set(d.ambiguityId, d);
  }
  const findings = [];
  for (const ambiguity of testCase.ambiguities) {
    const d = byId.get(ambiguity.id);
    let disposition, reason;
    if (!d) {
      disposition = "BLOCKED";
      reason = "MISSING_DECISION";
    } else if (["security_privilege", "external_effect", "destructive_change"].includes(ambiguity.classification)) {
      disposition = "BLOCKED";
      reason = "R1_NO_VERIFIED_EXTERNAL_AUTHORITY";
    } else if (ambiguity.classification === "material_business") {
      const declared = ["explicit_owner", "trusted_existing_contract"].includes(d.origin) &&
        d.evidenceRefs.length > 0;
      const policy = d.origin === "approved_policy" &&
        typeof d.policyRef === "string" && d.policyRef.length > 0 &&
        d.evidenceRefs.length > 0;
      disposition = declared || policy ? "DECLARED_UNVERIFIED" : "BLOCKED";
      reason = disposition === "BLOCKED" ? "MATERIAL_RULE_WITHOUT_OWNER_OR_POLICY_EVIDENCE" :
        "REFERENCES_NOT_INDEPENDENTLY_AUTHENTICATED";
    } else {
      disposition = d.origin === "agent_assumption" ? "PROVISIONAL" : "DECLARED_UNVERIFIED";
      reason = d.origin === "agent_assumption" ? "REVERSIBLE_TECHNICAL_ASSUMPTION" :
        "REFERENCES_NOT_INDEPENDENTLY_AUTHENTICATED";
    }
    findings.push({ ambiguityId: ambiguity.id, classification: ambiguity.classification,
      disposition, reason });
  }
  const blockers = findings.filter(f => f.disposition === "BLOCKED");
  const status = blockers.length ? "BLOCKED" :
    intake.policy === "autonomous_reviewable" ? "DRAFT_CANDIDATE_UNVERIFIED" : "REVIEW_REQUIRED";
  return {
    schemaVersion: "protocolia-r1-audit/v1", caseId: testCase.id, policy: intake.policy,
    status, blockers, findings,
    limitations: [
      "No AI was invoked or TypeSpec was generated by this R1 audit.",
      "Origin/evidence claims are supplied by the candidate and NOT independently authenticated.",
      "No permission to deploy, migrate, charge, export data or modify production.",
      "A draft candidate is not a verified requirement or a finished application."
    ]
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}
export function main(argv) {
  if (argv[0] === "check" && argv.length === 2) {
    const c = validateCase(readJson(argv[1]));
    process.stdout.write(JSON.stringify({ status: "VALID_SMOKE_FIXTURE", caseId: c.id,
      requirements: c.requirements.length, ambiguities: c.ambiguities.length }) + "\n");
    return 0;
  }
  if (argv[0] === "audit" && argv.length === 3) {
    const report = auditIntake(readJson(argv[1]), readJson(argv[2]));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return report.status === "DRAFT_CANDIDATE_UNVERIFIED" ? 0 : 2;
  }
  process.stderr.write("Usage: autonomy-r1.mjs check <case.json> | audit <case.json> <intake.json>\n");
  return 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    // No content of supplied documents or private input is echoed by this error handler.
    process.stderr.write("R1_INPUT_REJECTED: " + String(err.message).slice(0, 300) + "\n");
    process.exitCode = 1;
  }
}
