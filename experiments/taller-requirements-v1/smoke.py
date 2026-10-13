#!/usr/bin/env python3
"""Direct HTTP + JDBC-backed smoke proof for new requirements, no mocks."""
import base64
from concurrent.futures import ThreadPoolExecutor
import json
import os
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError,URLError

base="http://127.0.0.1:"+os.environ.get("PORT","10000")
def auth(name,pw):
 return "Basic "+base64.b64encode((name+":"+pw).encode()).decode()
writer=auth(os.environ["PROTOCOLIA_USER"],os.environ["PROTOCOLIA_PASSWORD"])
reader=auth(os.environ["PROTOCOLIA_VIEWER_USER"],os.environ["PROTOCOLIA_VIEWER_PASSWORD"])
def call(method,path,data=None,token=None):
 headers={"Accept":"application/json"}
 if token:headers["Authorization"]=token
 if data is not None:headers["Content-Type"]="application/json"
 body=json.dumps(data).encode() if data is not None else None
 req=Request(base+path,headers=headers,data=body,method=method)
 try:
  with urlopen(req,timeout=12) as resp:
   raw=resp.read();typ=resp.headers.get("Content-Type","")
   return resp.status,json.loads(raw) if "json" in typ else raw.decode(errors="replace")
 except HTTPError as error:
  return error.code,error.read().decode(errors="replace")
ready=False
for _ in range(40):
 try:
  status,body=call("GET","/health")
  if status==200:ready=True;break
 except (URLError,OSError):pass
 time.sleep(1)
assert ready,"app failed to serve /health"
assert call("GET","/")[0]==200
assert call("GET","/api/tools")[0]==401
status,page=call("GET","/api/tools?limit=2&offset=0",token=writer)
assert status==200 and page["total"]>=4,(status,page)
assert len(page["items"])==2
assert call("GET","/api/tools?limit=2&offset=0",token=reader)[0]==200
assert call("POST","/api/tools",{"code":"nope","name":"x","quantity":0},reader)[0]==403
code="P5-TEST-REAL-001"
payload={"code":code,"name":"Osciloscopio de verificación","quantity":2,"lastReviewedAt":"2026-10-12T10:30:00Z"}
status,result=call("POST","/api/tools",payload,writer)
assert status==201,(status,result)
assert result["code"]==code and result["lastReviewedAt"] and result["quantity"]==2,result
assert call("POST","/api/tools",payload,writer)[0]==409
assert call("GET","/api/tools/"+code,token=writer)[0]==200
assert call("PATCH","/api/tools/"+code+"/quantity",{"amount":0},writer)[0]==400
assert call("PATCH","/api/tools/"+code+"/quantity",{"amount":1001},writer)[0]==400
assert call("PATCH","/api/tools/"+code+"/name",{"name":" "},writer)[0]==400
assert call("PATCH","/api/tools/unknown-"+code+"/name",{"name":"Valid"},writer)[0]==404
assert call("PATCH","/api/tools/"+code+"/name",{"name":"Nombre actualizado"},reader)[0]==403
status,result=call("PATCH","/api/tools/"+code+"/name",{"name":"Nombre actualizado"},writer)
assert status==200 and result["name"]=="Nombre actualizado",(status,result)
def inc(_):
 return call("PATCH","/api/tools/"+code+"/quantity",{"amount":1},writer)
with ThreadPoolExecutor(max_workers=6) as pool:
 results=list(pool.map(inc,range(10)))
assert all(result[0]==200 for result in results),results
status,result=call("GET","/api/tools/"+code,token=writer)
assert status==200 and result["quantity"]==12 and result["name"]=="Nombre actualizado",(status,result)
assert result["lastReviewedAt"] is not None
assert call("GET","/api/tools?limit=0",token=writer)[0]==400
assert call("GET","/api/tools?limit=51",token=writer)[0]==400
assert call("POST","/api/tools",{"code":"BAD","name":"","quantity":1},writer)[0]==400
assert call("POST","/api/tools",{"code":"BAD","name":"bad","quantity":-1},writer)[0]==400
assert call("POST","/api/tools",{"code":"BAD","name":"bad","quantity":1,"unknown":1},writer)[0]==400
print("TALLER_REAL_HTTP_POSTGRES_AUTH_SMOKE_PASS")
print("tool_operations=5 read/write endpoints, concurrent increments=10, persisted_total=12, demo_rows>=4")
