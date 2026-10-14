import assert from "node:assert/strict";
const root="http://127.0.0.1:8080";
const auth=(u)=>"Basic "+Buffer.from(u+":"+process.env[u==="manager"?"PROTOCOLIA_MANAGER_PASSWORD":"PROTOCOLIA_READER_PASSWORD"]).toString("base64");
const manager=auth("manager"),reader=auth("reader");
const call=async(method,path,user,body)=>{
  const response=await fetch(root+path,{method,headers:{...(user?{Authorization:user}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const content=await response.text();let data;try{data=JSON.parse(content);}catch{data=content;}
  return {status:response.status,data};
};
const check=async(status,method,path,user,body)=>{
  const result=await call(method,path,user,body);
  assert.equal(result.status,status,method+" "+path+" returned "+JSON.stringify(result).slice(0,700));
  return result.data;
};
const key="/api/tickets/TK-A14",assignment=key+"/technician";
const phase=process.argv[2]??"seed";
if(phase==="seed"){
  await check(201,"POST","/api/sites",manager,{code:"S-A14",name:"Campus",address:"Building 1"});
  for(const badge of ["TE-A","TE-B","TE-C"])await check(201,"POST","/api/technicians",manager,{badge,name:"Technician "+badge,skill:"Maintenance"});
  await check(201,"POST","/api/machines",manager,{tag:"M-A14",siteCode:"S-A14",name:"Pump",category:"Mechanical"});
  await check(201,"POST","/api/tickets",manager,{number:"TK-A14",machineTag:"M-A14",technicianBadge:"TE-A",title:"Inspection",severity:"high",status:"reported"});
  await check(401,"PATCH",assignment,null,{expected:"TE-A",technicianBadge:"TE-B"});
  await check(403,"PATCH",assignment,reader,{expected:"TE-A",technicianBadge:"TE-B"});
  await check(400,"PATCH",assignment,manager,{expected:"TE-A",technicianBadge:"UNKNOWN"});
  await check(400,"PATCH",assignment,manager,{expected:"TE-A",technicianBadge:"TE-B",unexpected:true});
  await check(400,"PATCH",assignment,manager,{expected:"",technicianBadge:"TE-B"});
  await check(404,"PATCH","/api/tickets/UNKNOWN/technician",manager,{expected:"TE-A",technicianBadge:"TE-B"});
  await check(409,"PATCH",assignment,manager,{expected:"TE-A",technicianBadge:"TE-A"});
  const race=await Promise.all(Array.from({length:10},()=>call("PATCH",assignment,manager,{expected:"TE-A",technicianBadge:"TE-B"})));
  assert.equal(race.filter(v=>v.status===200).length,1,JSON.stringify(race));
  assert.equal(race.filter(v=>v.status===409).length,9,JSON.stringify(race));
  await check(409,"PATCH",assignment,manager,{expected:"TE-A",technicianBadge:"TE-C"});
  assert.equal((await check(200,"GET",key,reader)).technicianBadge,"TE-B");
  const audit=await check(200,"GET",key+"/audit?limit=10&offset=0",manager);
  assert.equal(audit.total,3);
  assert.deepEqual([audit.items[0].fieldName,audit.items[0].beforeValue,audit.items[0].afterValue],["technicianBadge","TE-A","TE-B"]);
  console.log("A14_REASSIGNMENT_FK_AUTH_CAS_AUDIT_HTTP_PASS");
}else if(phase==="fail-audit"){
  await check(500,"PATCH",assignment,manager,{expected:"TE-B",technicianBadge:"TE-C"});
  assert.equal((await check(200,"GET",key,reader)).technicianBadge,"TE-B");
  assert.equal((await check(200,"GET",key+"/audit?limit=10&offset=0",manager)).total,3);
  console.log("A14_REASSIGNMENT_AUDIT_FAILURE_ATOMIC_ROLLBACK_PASS");
}else if(phase==="recover"){
  await check(200,"PATCH",assignment,manager,{expected:"TE-B",technicianBadge:"TE-C"});
  assert.equal((await check(200,"GET",key,reader)).technicianBadge,"TE-C");
  assert.equal((await check(200,"GET",key+"/audit?limit=10&offset=0",manager)).total,4);
  console.log("A14_REASSIGNMENT_RECOVERY_HTTP_PASS");
}else throw Error("Invalid probe phase");
