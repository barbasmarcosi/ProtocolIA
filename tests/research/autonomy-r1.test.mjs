import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { validateCase, auditIntake } from "../../scripts/research/autonomy-r1.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = name => JSON.parse(readFileSync(join(root, "research/autonomous-engineering/cases/" + name + ".json"), "utf8"));
const intake = () => JSON.parse(readFileSync(join(root, "research/autonomous-engineering/samples/kiosk-autonomous-intake.json"), "utf8"));
const caseFile = name => join(root, "research/autonomous-engineering/cases/" + name + ".json");
const sampleFile = join(root, "research/autonomous-engineering/samples/kiosk-autonomous-intake.json");

test("all three frozen R1 smoke fixtures validate", () => {
  for (const name of ["kiosk", "workshop", "rehydration"]) {
    const c = fixture(name);
    assert.equal(validateCase(c).sourceType, "synthetic");
    assert.ok(c.requirements.length >= 2);
    assert.ok(c.ambiguities.length > 0);
  }
});
test("case fixtures reject unknown fields, duplicate IDs and unsupported origin claims", () => {
  const c = fixture("kiosk");
  c.unspecified = "silent";
  assert.throws(() => validateCase(c), /unexpected field/);
  delete c.unspecified;
  c.ambiguities[1].id = c.ambiguities[0].id;
  assert.throws(() => validateCase(c), /duplicate ID/);
  c.ambiguities[1].id = "K-A02";
  c.sourceType = "external_customer";
  assert.throws(() => validateCase(c), /synthetic smoke/);
});
test("sample explicitly blocks invented material business and privilege policies", () => {
  const r = auditIntake(fixture("kiosk"), intake());
  assert.equal(r.status, "BLOCKED");
  assert.deepEqual(r.blockers.map(x => x.ambiguityId), ["K-A01", "K-A02", "K-A04"]);
  assert.equal(r.findings.find(x => x.ambiguityId === "K-A03").disposition, "PROVISIONAL");
  assert.match(r.limitations.join(" "), /NOT independently authenticated/);
});
test("missing mandatory ambiguities must not silently pass", () => {
  const d = intake();
  d.decisions = d.decisions.filter(x => x.ambiguityId !== "K-A02");
  const r = auditIntake(fixture("kiosk"), d);
  assert.equal(r.findings.find(x => x.ambiguityId === "K-A02").reason, "MISSING_DECISION");
});
test("unknown or duplicate ambiguity decisions are invalid input", () => {
  const d = intake();
  d.decisions.push({ ...d.decisions[0] });
  assert.throws(() => auditIntake(fixture("kiosk"), d), /duplicate decision/);
  d.decisions.pop();
  d.decisions[0].ambiguityId = "K-NONEXISTENT";
  assert.throws(() => auditIntake(fixture("kiosk"), d), /unknown ambiguity/);
});
test("a candidate cannot downgrade a material question to reversible", () => {
  const d = intake();
  d.decisions[0].classification = "reversible_technical";
  assert.throws(() => auditIntake(fixture("kiosk"), d), /reclassification/);
});
test("even claimed owner approval cannot authorize external effects in R1", () => {
  const c = fixture("workshop");
  const d = {
    schemaVersion: "protocolia-intake/v1", caseId: c.id, policy: "autonomous_reviewable",
    decisions: c.ambiguities.map(a => ({
      ambiguityId: a.id, classification: a.classification,
      origin: "explicit_owner", choice: "Sample decision", rationale: "Test assertion",
      evidenceRefs: ["asserted:local"], approvalRef: "asserted:approval"
    }))
  };
  const r = auditIntake(c, d);
  assert.equal(r.status, "BLOCKED");
  assert.ok(r.blockers.some(x => x.ambiguityId === "W-A03"));
  assert.equal(r.findings.find(x => x.ambiguityId === "W-A01").disposition, "DECLARED_UNVERIFIED");
});
test("reversible technical decision can produce unverified draft but not production authorization", () => {
  const c = fixture("rehydration");
  c.ambiguities = c.ambiguities.filter(x => x.classification === "reversible_technical");
  const a = c.ambiguities[0];
  const d = { schemaVersion: "protocolia-intake/v1", caseId: c.id,
    policy: "autonomous_reviewable", decisions: [{
      ambiguityId: a.id, classification: a.classification,
      origin: "agent_assumption", choice: "Alphabetical glossary", rationale: "Easy to reverse",
      evidenceRefs: []
    }] };
  const result = auditIntake(c, d);
  assert.equal(result.status, "DRAFT_CANDIDATE_UNVERIFIED");
  assert.equal(result.blockers.length, 0);
  assert.match(result.limitations.join(" "), /No permission to deploy/);
  d.policy = "review_contracts";
  assert.equal(auditIntake(c, d).status, "REVIEW_REQUIRED");
});
test("CLI reports case check success and blocked intake with nonzero exit", () => {
  const cli = join(root, "scripts/research/autonomy-r1.mjs");
  const checked = spawnSync(process.execPath, [cli, "check", caseFile("kiosk")], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).status, "VALID_SMOKE_FIXTURE");
  const blocked = spawnSync(process.execPath,
    [cli, "audit", caseFile("kiosk"), sampleFile], { encoding: "utf8" });
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).status, "BLOCKED");
});
