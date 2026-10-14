import assert from 'node:assert/strict';
const base='http://127.0.0.1:8080/api/notifications/technician';
const phase=process.argv[2]??'bound';
async function call(path='',{user='manager',method='GET',body,headers={}}={}){
 const password=user==='manager'?process.env.PROTOCOLIA_MANAGER_PASSWORD:process.env.PROTOCOLIA_READER_PASSWORD;
 const response=await fetch(base+path,{method,headers:{...(user?{Authorization:'Basic '+Buffer.from(user+':'+password).toString('base64')}:{ }),...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 let json;try{json=await response.json();}catch{json=null;}
 return {status:response.status,json};
}
assert.equal((await call('',{user:''})).status,401);
assert.equal((await call('',{user:'intruder'})).status,401);
if(phase==='unbound'){
 for(const user of ['manager','reader'])assert.equal((await call('',{user})).status,403);
 assert.equal((await call('/1/ack',{method:'POST'})).status,403);
 console.log('A143_UNPROVISIONED_IDENTITY_FAIL_CLOSED_PASS');
}else{
 const manager=await call(),reader=await call('',{user:'reader'});
 assert.equal(manager.status,200);assert.equal(manager.json.total,13);
 assert.equal(reader.status,200);assert.equal(reader.json.total,1);
 assert.ok(manager.json.items.every(i=>i.recipientKey==='T'));
 assert.ok(reader.json.items.every(i=>i.recipientKey==='U'));
 assert.ok(!manager.json.items.some(i=>i.id===reader.json.items[0].id));
 for(const item of [...manager.json.items,...reader.json.items]){
  assert.equal(item.entityName,'Ticket');assert.equal(item.ruleKey,'Ticket.overdue');
  assert.ok(Number.isFinite(Date.parse(item.eventAt)));assert.ok(Number.isFinite(Date.parse(item.notifiedAt)));
 }
 const first=await call('?limit=5&offset=0'),second=await call('?limit=5&offset=5'),empty=await call('?offset=999999');
 assert.equal(first.json.items.length,5);assert.equal(second.json.items.length,5);
 assert.ok(first.json.items.every(x=>!second.json.items.some(y=>x.id===y.id)));
 assert.deepEqual(empty.json.items,[]);assert.equal(empty.json.total,13);
 for(const query of ['?limit=0','?limit=51','?offset=-1','?offset=1000001','?limit=no','?limit=1&limit=2','?recipientKey=U','?subject=reader','?limit=1.5'])
  assert.equal((await call(query)).status,400,query);
 const spoof=await call('',{headers:{'X-Subject':'reader','X-Recipient-Key':'U'}});
 assert.deepEqual(spoof.json.items.map(x=>x.id),manager.json.items.map(x=>x.id));
 const foreign=reader.json.items[0].id,own=manager.json.items[0].id;
 assert.equal((await call('/'+foreign+'/ack',{method:'POST'})).status,404);
 assert.equal((await call('/9223372036854775807/ack',{method:'POST'})).status,404);
 assert.equal((await call('/'+foreign+'/ack',{method:'POST',user:'reader'})).status,403);
 assert.equal((await call('/'+own+'/ack?subject=reader',{method:'POST'})).status,400);
 assert.equal((await call('/'+own+'/ack',{method:'POST',body:{recipientKey:'U'}})).status,400);
 for(const id of ['0','-1','no','9223372036854775808'])assert.equal((await call('/'+id+'/ack',{method:'POST'})).status,400,id);
 const responses=await Promise.all(Array.from({length:10},()=>call('/'+own+'/ack',{method:'POST'})));
 assert.ok(responses.every(r=>r.status===200));
 assert.ok(responses.every(r=>r.json.id===own&&r.json.readAt));
 assert.equal(new Set(responses.map(r=>r.json.readAt)).size,1,'acknowledgement is idempotent under contention');
 const repeat=await call('/'+own+'/ack',{method:'POST'});
 assert.equal(repeat.json.readAt,responses[0].json.readAt);
 assert.equal((await call('',{user:'reader'})).json.items[0].readAt,null,'foreign acknowledgement never changed the row');
 if(phase==='restart')assert.ok(manager.json.items.some(x=>x.readAt),'receipt survives application restart');
 console.log('A143_RECIPIENT_HTTP_400_401_403_404_ISOLATION_PAGINATION_CONCURRENT_ACK_PASS '+phase);
}
