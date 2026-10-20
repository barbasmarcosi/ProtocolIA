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

const duplicate = await req("/api/tools", {
  method: "POST", headers,
  body: JSON.stringify({ code, name: "Duplicate fixture", quantity: 99 }),
});
console.log("A0_DUPLICATE_CODE_STATUS=" + duplicate.status + " REQUIRED=409");
const negative = await req("/api/tools", {
  method: "POST", headers,
  body: JSON.stringify({ code: "A0-NEGATIVE", name: "Invalid quantity", quantity: -1 }),
});
console.log("A0_NEGATIVE_QUANTITY_STATUS=" + negative.status + " REQUIRED=4XX");
const unexpected = await req("/api/tools", {
  method: "POST", headers,
  body: JSON.stringify({ code: "A0-UNKNOWN", name: "Extra property", quantity: 2, notInContract: 15 }),
});
console.log("A0_UNKNOWN_PROPERTY_STATUS=" + unexpected.status + " REQUIRED=4XX");
console.log("A0_INTERNAL_ID_EXPOSED_IN_PUBLIC_JSON=" + Object.hasOwn(created.value,"id"));
const anonymous = await req("/api/tools/" + numericId);
console.log("A0_ANONYMOUS_GET_STATUS=" + anonymous.status + " REQUIRED=401");
const userLogin = await req("/api/authenticate", {
  method: "POST", headers: { "content-type":"application/json" },
  body: JSON.stringify({ username:"user", password:"user", rememberMe:false }),
});
console.log("A0_JHIPSTER_STOCK_USER_LOGIN=" + userLogin.status);
if(userLogin.status===200 && userLogin.value?.id_token){
  const viewerHeaders = { "content-type":"application/json", authorization:"Bearer "+userLogin.value.id_token };
  const readerWrite = await req("/api/tools", {
    method:"POST",headers:viewerHeaders,
    body:JSON.stringify({code:"A0-READER-WRITE",name:"Forbidden read-only test",quantity:1}),
  });
  console.log("A0_STOCK_ROLE_USER_CAN_POST_STATUS=" + readerWrite.status + " EXPECTED_CONTRACT_READ_ONLY=403");
} else {
  console.log("A0_STOCK_ROLE_USER_WRITE_TEST_BLOCKED=true");
}

console.log("A0_REAL_POSTGRES_STOCK_CRUD_HTTP_PASS");
