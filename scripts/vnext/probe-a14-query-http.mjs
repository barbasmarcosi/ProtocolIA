import assert from "node:assert/strict";
const base="http://127.0.0.1:8080";
const basic=(u)=>"Basic "+Buffer.from(u+":"+
 process.env[u==="manager"?"PROTOCOLIA_MANAGER_PASSWORD":"PROTOCOLIA_READER_PASSWORD"]).toString("base64");
const manager=basic("manager"),reader=basic("reader");
async function request(method,path,authorization,body){
 const result=await fetch(base+path,{method,headers:{...(authorization?{Authorization:authorization}:{}),
   ...(body===undefined?{}:{"Content-Type":"application/json"})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const raw=await result.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
 return {status:result.status,data};
}
async function check(status,method,path,user,body){
 const result=await request(method,path,user,body);
 assert.equal(result.status,status,method+" "+path+": "+JSON.stringify(result).slice(0,800));
 return result.data;
}
const search="/api/tickets/query/filtered";
const phase=process.argv[2]??"seed";
if(phase==="seed"){
 for(const [code,name] of [["S-N","North"],["S-S","South"]])
  await check(201,"POST","/api/sites",manager,{code,name,address:"Main Street"});
 await check(201,"POST","/api/technicians",manager,{badge:"T-01",name:"Alice",skill:"Diagnostics"});
 for(const [tag,siteCode] of [["M-1","S-N"],["M-2","S-N"],["M-3","S-S"]])
  await check(201,"POST","/api/machines",manager,{tag,siteCode,name:"Machine "+tag,category:"Industrial"});
 for(const [number,machineTag,dueAt] of [
  ["K1","M-1","2026-10-18T10:00:00Z"],["K2","M-2","2026-10-20T10:00:00Z"],
  ["K3","M-3","2026-10-19T10:00:00Z"],["K4","M-2",null],
  ["K5","M-1","2026-10-24T10:00:00Z"]
 ]){
  await check(201,"POST","/api/tickets",manager,{number,machineTag,technicianBadge:"T-01",
   title:"Maintenance "+number,severity:"high",status:"reported",...(dueAt?{dueAt}:{})});
 }
 await check(200,"POST","/api/tickets/K2/plan",manager);
 console.log("A142_SEEDED_MULTI_SITE_FILTER_FIXTURE_PASS");
}
if(phase==="verify"){
 await check(401,"GET",search+"?siteCode=S-N",null);
 const listing=await check(200,"GET",search+"?siteCode=S-N&limit=50&offset=0",reader);
 assert.equal(listing.total,4);
 assert.deepEqual(listing.items.map(t=>t.number),["K1","K2","K5","K4"],
  "Date ordering must sort NULL last, then identity");
 const exact=await check(200,"GET",search+"?siteCode=S-N&status=reported&dueFrom=2026-10-18T00%3A00%3A00Z&dueTo=2026-10-23T00%3A00%3A00Z",reader);
 assert.deepEqual(exact.items.map(x=>x.number),["K1"]);
 assert.equal(exact.total,1);
 const planned=await check(200,"GET",search+"?siteCode=S-N&status=planned",reader);
 assert.deepEqual(planned.items.map(x=>x.number),["K2"]);
 const p2=await check(200,"GET",search+"?siteCode=S-N&dueFrom=2026-10-18T00%3A00%3A00Z&dueTo=2026-10-21T00%3A00%3A00Z&limit=1&offset=1",reader);
 assert.equal(p2.total,2);assert.equal(p2.items.length,1);assert.equal(p2.items[0].number,"K2");
 for(const path of [
   search+"?foo=bar",
   search+"?siteCode=S-N&offset=-1",
   search+"?siteCode=S-N&limit=51",
   search+"?dueFrom=invalid",
   search+"?dueFrom=2026-10-23T00%3A00%3A00Z&dueTo=2026-10-18T00%3A00%3A00Z"
 ])await check(400,"GET",path,reader);
 const injected=await check(200,"GET",search+"?siteCode="+encodeURIComponent("S-N' OR 1=1 --"),reader);
 assert.equal(injected.total,0);
 assert.equal((await check(200,"GET",search+"?limit=25&offset=0",reader)).total,5);
 console.log("A142_BOTH_TARGETS_TYPED_COMBINED_FK_STATUS_DATE_SEARCH_AND_PAGING_PASS");
}
