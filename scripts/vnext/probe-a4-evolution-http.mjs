import assert from "node:assert/strict";
const base="http://127.0.0.1:8080";
const auth="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
const headers={Authorization:auth,"Content-Type":"application/json"};
const payload={number:"I-CHECKED",equipmentCode:"E-001",notes:"New optional field",
  checkedAt:"2026-10-13T11:00:00+02:00"};
const response=await fetch(base+"/api/inspections",{method:"POST",headers,body:JSON.stringify(payload)});
assert.equal(response.status,201,await response.text());
const read=await fetch(base+"/api/inspections/I-CHECKED",{headers});
assert.equal(read.status,200);
const row=await read.json();
assert.equal(Date.parse(row.checkedAt),Date.parse("2026-10-13T09:00:00Z"));
const deleted=await fetch(base+"/api/inspections/I-CHECKED",{method:"DELETE",headers});
assert.equal(deleted.status,204);
console.log("A4_EVOLVED_OPTIONAL_TIMESTAMP_POSTGRES_ROUNDTRIP_PASS");
