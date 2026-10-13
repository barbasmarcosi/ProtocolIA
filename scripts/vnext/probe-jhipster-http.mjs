import assert from "node:assert/strict";
const base = "http://127.0.0.1:8080";
async function req(path, init = {}) {
  const res = await fetch(base + path, init);
  const raw = await res.text();
  let value;
  try { value = JSON.parse(raw); } catch { value = raw; }
  return { status: res.status, value, type: res.headers.get("content-type") };
}
const front = await req("/");
console.log("A0_GENERATED_FRONTEND_STATUS=" + front.status);
assert.equal(front.status, 200, "Generated web app did not serve HTML");
const login = await req("/api/authenticate", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin", rememberMe: false }),
});
console.log("A0_GENERATED_JWT_LOGIN_STATUS=" + login.status);
assert.equal(login.status, 200, "Generated development login failed");
assert.ok(login.value?.id_token, "No JWT returned");
const headers = {
  "content-type": "application/json",
  "authorization": "Bearer " + login.value.id_token,
};
const code = "A0-REAL-001";
const created = await req("/api/tools", {
  method: "POST", headers,
  body: JSON.stringify({ code, name: "Fixture A0", quantity: 2, lastReviewedAt: null }),
});
console.log("A0_GENERATED_CREATE_STATUS=" + created.status);
assert.equal(created.status, 201, "Stock JHipster CRUD POST failed");
assert.equal(created.value.code, code);
const numericId = created.value.id;
assert.equal(typeof numericId, "number");
const read = await req("/api/tools/" + numericId, { headers });
console.log("A0_GENERATED_GET_BY_INTERNAL_ID_STATUS=" + read.status);
assert.equal(read.status, 200);
assert.equal(read.value.quantity, 2);
const list = await req("/api/tools", { headers });
console.log("A0_GENERATED_LIST_STATUS=" + list.status);
assert.equal(list.status, 200);
console.log("A0_GENERATED_LIST_IS_ARRAY=" + Array.isArray(list.value));
const publicRead = await req("/api/tools/" + code, { headers });
const increment = await req("/api/tools/" + code + "/quantity", {
  method: "PATCH", headers, body: JSON.stringify({ amount: 3 }),
});
const rename = await req("/api/tools/" + code + "/name", {
  method: "PATCH", headers, body: JSON.stringify({ name: "Renamed" }),
});
console.log("A0_PUBLIC_CODE_GET_STATUS=" + publicRead.status + " REQUIRED=200");
console.log("A0_CONTRACT_INCREMENT_STATUS=" + increment.status + " REQUIRED=200");
console.log("A0_CONTRACT_RENAME_STATUS=" + rename.status + " REQUIRED=200");
console.log("A0_STOCK_JHIPSTER_FULL_PARITY=" +
  (publicRead.status === 200 && increment.status === 200 && rename.status === 200 &&
   !Array.isArray(list.value) && Array.isArray(list.value?.items)));
console.log("A0_REAL_POSTGRES_STOCK_CRUD_HTTP_PASS");
