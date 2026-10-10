"""Black-box HTTP acceptance suite against generated Spring service on disposable PostgreSQL."""
import base64
from concurrent.futures import ThreadPoolExecutor
import json
import sys
import time
from urllib.error import HTTPError,URLError
from urllib.request import Request,urlopen
from uuid import uuid4

BASE="http://127.0.0.1:8080"
AUTH="Basic "+base64.b64encode(b"test-admin:independent-ephemeral-credential-2026").decode()
VIEWER="Basic "+base64.b64encode(b"test-viewer:readonly-ephemeral-password-2026").decode()

def call(method,path,body=None,auth=AUTH):
    headers={"Content-Type":"application/json"}
    if auth is not None:headers["Authorization"]=auth
    request=Request(BASE+path,data=None if body is None else json.dumps(body).encode(),
                    headers=headers,method=method)
    try:
        with urlopen(request,timeout=20) as res:
            raw=res.read()
            return res.status,json.loads(raw) if raw else None
    except HTTPError as exc:
        return exc.code,None

def expected(method,path,payload,status,auth=AUTH):
    got,data=call(method,path,payload,auth)
    assert got==status,(method,path,status,got,data)
    return data

for attempt in range(80):
    try:
        if call("GET","/health",auth=None)[0]==200:break
    except (OSError,URLError):pass
    time.sleep(1)
else:
    raise AssertionError("Spring service did not respond to /health")

assert expected("GET","/health",None,200,auth=None)["status"]=="ok"
expected("POST","/products",{"sku":"ab","quantity":1},401,auth=None)
expected("POST","/products",{"sku":"ab","quantity":1},401,auth="Basic bad")
expected("POST","/products",{"sku":"ab","quantity":1},403,auth=VIEWER)
expected("POST","/products",{"sku":"ab","quantity":-1},400)
expected("POST","/products",{"sku":"ab","quantity":1,"unexpected":"reject"},400)
expected("POST","/products",{"sku":"ab","quantity":"bad"},400)
expected("POST","/products",{"quantity":2},400)
product=expected("POST","/products",{"sku":"test"+uuid4().hex[:16],"quantity":2},200)
pid=product["id"]
assert product["quantity"]==2
expected("GET",f"/products/{pid}/stock",None,200)
expected("POST","/products",{"sku":product["sku"],"quantity":3},409)
expected("GET",f"/products/{uuid4()}/stock",None,404)

keys=[str(uuid4()) for _ in range(4)]
def one(k):
    return call("POST","/sales",{"product_id":pid,"quantity":1,"idempotency_key":k})
with ThreadPoolExecutor(max_workers=4) as pool:
    outcomes=list(pool.map(one,keys))
assert sorted(x[0] for x in outcomes)==[200,200,409,409],outcomes
assert expected("GET",f"/products/{pid}/stock",None,200)["stock"]==0

successful=[(k,body) for k,(code,body) in zip(keys,outcomes) if code==200]
for key,response in successful:
    replay=expected("POST","/sales",{"product_id":pid,"quantity":1,"idempotency_key":key},200)
    assert replay["id"]==response["id"] and replay["status"]=="COMPLETED"
expected("POST","/sales",{"product_id":pid,"quantity":2,"idempotency_key":successful[0][0]},409)
assert expected("GET",f"/products/{pid}/stock",None,200)["stock"]==0

pid2=expected("POST","/products",{"sku":"idem"+uuid4().hex[:16],"quantity":1},200)["id"]
same=str(uuid4())
with ThreadPoolExecutor(max_workers=2) as pool:
    replays=list(pool.map(one,[same,same])) if False else list(pool.map(
       lambda _:call("POST","/sales",{"product_id":pid2,"quantity":1,"idempotency_key":same}),range(2)))
assert all(code==200 for code,body in replays),replays
assert replays[0][1]["id"]==replays[1][1]["id"],replays
assert expected("GET",f"/products/{pid2}/stock",None,200)["stock"]==0
expected("POST","/sales",{"product_id":pid2,"quantity":1,"idempotency_key":str(uuid4())},409)
print("P2 HTTP+PostgreSQL: PASS health, 401, DTO 400, 404, unique 409, "
      "4-way atomic stock race, idempotency replay and concurrent same-key submission")
