import assert from "node:assert/strict";
const root="http://127.0.0.1:8080";
const basic=(u,p)=>"Basic "+Buffer.from(u+":"+p).toString("base64");
const manager=basic("manager","test-manager-only-2026");
const reader=basic("reader","test-reader-only-2026");
async function query(method,path,auth,body){
 const res=await fetch(root+path,{method,headers:{...(auth?{Authorization:auth}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},
 ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const raw=await res.text();
 let data;try{data=JSON.parse(raw);}catch{data=raw;}
 return {status:res.status,data};
}
async function check(expected,method,path,auth,body){
 const r=await query(method,path,auth,body);
 assert.equal(r.status,expected,method+" "+path+" response="+JSON.stringify(r).slice(0,1800));
 return r.data;
}
const ticket="/api/tickets",sites="/api/sites",machines="/api/machines",techs="/api/technicians";
await check(401,"GET",ticket+"?limit=25&offset=0");
await check(403,"POST",sites,reader,{code:"S-DENIED",name:"Should fail",address:"None"});
await check(201,"POST",sites,manager,{code:"S-MAIN",name:"Sucursal Centro",address:"Belgrano 100"});
await check(201,"POST",sites,manager,{code:"S-WEST",name:"Sucursal Oeste",address:"Ruta 4 km 20"});
await check(409,"POST",sites,manager,{code:"S-MAIN",name:"Duplicate",address:"Other"});
await check(400,"POST",sites,manager,{code:"S-EMPTY",name:"",address:"Other"});
assert.equal((await check(200,"GET",sites+"?limit=25&offset=0",reader)).total,2);
console.log("A13_C01_SITE_VALIDATION_UNIQUE_PERSISTED_PASS");
await check(201,"POST",techs,manager,{badge:"TE-A",name:"Lucía Paz",skill:"Electricidad"});
await check(201,"POST",techs,manager,{badge:"TE-B",name:"Juan Torres",skill:"Mecánica"});
await check(409,"POST",techs,manager,{badge:"TE-A",name:"Other",skill:"Other"});
assert.equal((await check(200,"GET",techs+"?limit=25&offset=0",reader)).total,2);
console.log("A13_C03_TECHNICIAN_DIRECTORY_VALIDATED_PASS");
await check(400,"POST",machines,manager,{tag:"MC-ORPHAN",siteCode:"S-NO",name:"Compresor huérfano",category:"Aire"});
await check(201,"POST",machines,manager,{tag:"MC-001",siteCode:"S-MAIN",name:"Compresor central",category:"Climatización"});
await check(201,"POST",machines,manager,{tag:"MC-002",siteCode:"S-WEST",name:"Generador de reserva",category:"Energía"});
await check(409,"DELETE",sites+"/S-MAIN",manager);
assert.equal((await check(200,"GET",machines+"/MC-001",reader)).siteCode,"S-MAIN");
console.log("A13_C02_MACHINE_SITE_FK_RESTRICT_PASS");
const invalid={number:"TK-ORPHAN",machineTag:"MC-NO",technicianBadge:"TE-A",title:"No equipment",severity:"high",status:"reported"};
await check(400,"POST",ticket,manager,invalid);
await check(400,"POST",ticket,manager,{...invalid,machineTag:"MC-001",technicianBadge:"TE-NO"});
const row=await check(201,"POST",ticket,manager,{number:"TK-001",machineTag:"MC-001",technicianBadge:"TE-A",
 title:"Climatizador no enfría",severity:"urgent",dueAt:"2026-10-20T14:30:00Z",status:"reported"});
assert.equal(row.machineTag,"MC-001");assert.equal(row.technicianBadge,"TE-A");
assert.match(row.dueAt,/2026-10-20/);
await check(201,"POST",ticket,manager,{number:"TK-002",machineTag:"MC-002",technicianBadge:"TE-B",
 title:"Revisión del generador",severity:"normal",status:"reported"});
await check(409,"POST",ticket,manager,{...invalid,number:"TK-001",machineTag:"MC-001"});
await check(400,"POST",ticket,manager,{...invalid,number:"TK-INVALID",machineTag:"MC-001",status:"completed"});
await check(409,"DELETE",machines+"/MC-001",manager);
await check(409,"DELETE",techs+"/TE-A",manager);
assert.equal((await check(200,"GET",ticket+"?limit=1&offset=0",reader)).total,2);
console.log("A13_C04_C05_DOUBLE_FK_TICKET_DATE_AND_FIELD_INTEGRITY_PASS");
await check(403,"POST",ticket,reader,{...invalid,number:"TK-READER",machineTag:"MC-001"});
await check(403,"POST",ticket+"/TK-001/plan",reader);
await check(409,"POST",ticket+"/TK-001/complete",manager);
const race=await Promise.all(Array.from({length:10},()=>query("POST",ticket+"/TK-001/plan",manager)));
assert.equal(race.filter(x=>x.status===200).length,1);
assert.equal(race.filter(x=>x.status===409).length,9);
await check(409,"POST",ticket+"/TK-001/plan",manager);
await check(200,"POST",ticket+"/TK-001/complete",manager);
await check(409,"POST",ticket+"/TK-001/complete",manager);
assert.equal((await check(200,"GET",ticket+"/TK-001",reader)).status,"completed");
console.log("A13_C06_C07_C09_STATEFUL_CONCURRENCY_AND_PERMISSIONS_PASS");
await check(401,"GET",ticket+"/TK-001/audit");
await check(403,"GET",ticket+"/TK-001/audit",reader);
await check(403,"GET",ticket+"/TK-NO/audit",reader);
await check(404,"GET",ticket+"/TK-NO/audit",manager);
const journal=await check(200,"GET",ticket+"/TK-001/audit?limit=10&offset=0",manager);
assert.equal(journal.total,4);
assert.deepEqual(journal.items.map(x=>[x.operationName,x.fieldName,x.beforeValue,x.afterValue]),[
 ["completeTicket","status","planned","completed"],["planTicket","status","reported","planned"],
 ["createTicket","status",null,"reported"],["createTicket","title",null,"Climatizador no enfría"]
]);
assert.ok(journal.items.every(x=>x.actor==="manager"&&x.resourceId==="TK-001"));
assert.equal((await check(200,"GET",ticket+"/TK-002/audit?limit=10&offset=0",manager)).total,2);
await check(400,"GET",ticket+"/TK-001/audit?limit=51&offset=0",manager);
console.log("A13_C08_C10_AUDIT_WRITES_ISOLATION_AND_SEPARATE_AUTH_PASS");
