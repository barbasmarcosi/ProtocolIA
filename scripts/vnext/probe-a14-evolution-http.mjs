import assert from "node:assert/strict";
const phase=process.argv[2]??"seed";
const root="http://127.0.0.1:8080";
const basic="Basic "+Buffer.from("manager:"+process.env.PROTOCOLIA_MANAGER_PASSWORD).toString("base64");
async function call(method,path,body){
 const response=await fetch(root+path,{method,headers:{Authorization:basic,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
 assert.equal(response.status,method==="POST"&&path!=="/api/tickets/TK-EVOLVE/technician"?201:200,
   method+" "+path+" response "+response.status+" "+JSON.stringify(data));
 return data;
}
if(phase==="seed"){
 await call("POST","/api/sites",{code:"S-EVOLVE",name:"Campus",address:"Building one"});
 for(const badge of ["TE-OLD","TE-NEW"])await call("POST","/api/technicians",{badge,name:badge,skill:"Maintenance"});
 await call("POST","/api/machines",{tag:"M-EVOLVE",siteCode:"S-EVOLVE",name:"Pump",category:"Mechanical"});
 await call("POST","/api/tickets",{number:"TK-EVOLVE",machineTag:"M-EVOLVE",technicianBadge:"TE-OLD",
  title:"Preserve old ticket",severity:"high",status:"reported"});
 const journal=await call("GET","/api/tickets/TK-EVOLVE/audit?limit=10&offset=0");
 assert.equal(journal.total,2);
 console.log("A14_EVOLUTION_ORIGINAL_A13_APP_DATA_AND_AUDIT_PASS");
}else if(phase==="verify"){
 const saved=await call("GET","/api/tickets/TK-EVOLVE");
 assert.equal(saved.technicianBadge,"TE-OLD");
 assert.equal(saved.title,"Preserve old ticket");
 const before=await call("GET","/api/tickets/TK-EVOLVE/audit?limit=10&offset=0");
 assert.equal(before.total,2);
 const updated=await call("PATCH","/api/tickets/TK-EVOLVE/technician",
   {expected:"TE-OLD",technicianBadge:"TE-NEW"});
 assert.equal(updated.technicianBadge,"TE-NEW");
 const after=await call("GET","/api/tickets/TK-EVOLVE/audit?limit=10&offset=0");
 assert.equal(after.total,3);
 assert.deepEqual([after.items[0].fieldName,after.items[0].beforeValue,after.items[0].afterValue],
  ["technicianBadge","TE-OLD","TE-NEW"]);
 console.log("A14_EVOLUTION_OLD_ROWS_AUDIT_AND_NEW_OPERATION_PRESERVED_PASS");
}else throw Error("Invalid phase "+phase);
