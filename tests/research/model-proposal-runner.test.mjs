import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {runModelProposal} from "../../scripts/research/model-proposal-runner.mjs";
import {compileDraft} from "../../scripts/research/intake-to-typespec.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const brief=join(root,"research/autonomous-engineering/samples/kiosk-owner-brief.json");
const template=join(root,"research/autonomous-engineering/samples/kiosk-agent-proposal-template.json");
function payload(){
 const x=JSON.parse(readFileSync(template,"utf8"));
 x.briefSha256=createHash("sha256").update(readFileSync(brief)).digest("hex");
 return x;
}
function serverResponse(proposal,extra={}){
 return {id:"cmpl-mock-test",model:"mock-research-model",choices:[
  {index:0,finish_reason:"stop",message:{role:"assistant",content:JSON.stringify(proposal)}}
 ],usage:{prompt_tokens:422,completion_tokens:133,total_tokens:555},...extra};
}
async function withServer(handler,fn){
 const server=createServer((req,res)=>{
  let body="";req.on("data",chunk=>body+=chunk);
  req.on("end",()=>handler(req,res,body));
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{return await fn("http://127.0.0.1:"+server.address().port+"/v1/chat/completions");}
 finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
async function workspace(fn){
 const base=mkdtempSync(join(tmpdir(),"protocolia-model-runner-"));
 const out=join(base,"proposal"),source=join(base,"brief.json");
 writeFileSync(source,readFileSync(brief));
 try{return await fn({out,source,base});}finally{rmSync(base,{recursive:true,force:true});}
}
function args(endpoint,{out,source},extra={}){
 return {endpoint,briefPath:source,outPath:out,networkApproved:true,model:"mock-model-v1",maxOutputTokens:800,
  timeoutMs:7000,...extra};
}
test("real localhost HTTP request returns source-bound, gated proposal and audit record",()=>workspace(async d=>{
 let requests=0;
 await withServer((req,res,body)=>{
  requests++;
  assert.equal(req.method,"POST");
  assert.equal(req.url,"/v1/chat/completions");
  assert.equal(req.headers.authorization,undefined);
  const j=JSON.parse(body);
  assert.deepEqual(Object.keys(j).sort(),["max_completion_tokens","messages","model","n","response_format","stream"].sort());
  assert.equal(j.model,"mock-model-v1");
  assert.equal(j.max_completion_tokens,800);
  assert.equal(j.response_format.type,"json_object");
  assert.equal(j.messages.length,2);
  assert.match(j.messages[1].content,/K-Q01/);
  res.writeHead(200,{"content-type":"application/json"});
  res.end(JSON.stringify(serverResponse(payload())));
 },async endpoint=>{
  const result=await runModelProposal(args(endpoint,d));
  assert.equal(result.status,"MODEL_RESPONSE_ADMITTED_UNVERIFIED");
  assert.equal(result.costUsd,"UNKNOWN_UNPRICED");
  assert.equal(result.usage.total_tokens,555);
  assert.equal(requests,1);
 });
 const r=JSON.parse(readFileSync(join(d.out,"model-run.json"),"utf8"));
 assert.equal(r.requestCount,1);
 assert.equal(r.adapter,"model-only-no-tools");
 assert.equal(r.credentialInRecord,false);
 assert.equal(r.reportedModel,"mock-research-model");
 assert.equal(r.modelReported,undefined);
 assert.deepEqual(r.usage,{prompt_tokens:422,completion_tokens:133,total_tokens:555});
 assert.equal(r.costUsd,"UNKNOWN_UNPRICED");
 assert.match(r.endpointOrigin,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
 const normalized=join(d.out,"intake.json");
 const contracts=join(d.base,"contracts");
 assert.equal(compileDraft(normalized,contracts).status,"PARTIAL_DRAFT_UNVERIFIED");
 assert.equal(JSON.parse(readFileSync(join(contracts,"protocolia-intake-report.json"),"utf8")).deferredRequirements.length,2);
}));
test("network explicit approval is mandatory; public HTTP and secret over HTTP fail before fetch",()=>workspace(async d=>{
 let count=0;
 const fake=async()=>{count++;throw Error("should not execute");};
 await assert.rejects(runModelProposal(args("http://127.0.0.1:31234/v1/chat/completions",d,{networkApproved:false}),fake),/network-approved/);
 await assert.rejects(runModelProposal(args("http://example.com/v1/chat/completions",d),fake),/HTTPS or loopback/);
 await assert.rejects(runModelProposal(args("http://127.0.0.1:31234/v1/chat/completions",d,{apiKey:"sensitive-key"}),fake),/HTTPS/);
 assert.equal(count,0);assert.equal(existsSync(d.out),false);
}));
test("model truncation and refusal never write artifacts",()=>workspace(async d=>{
 for(const finish_reason of ["length","content_filter","tool_calls"]){
  await withServer((req,res)=>{
   res.writeHead(200,{"content-type":"application/json"});
   res.end(JSON.stringify(serverResponse(payload(),{choices:[{finish_reason,message:{role:"assistant",content:JSON.stringify(payload())}}]})));
  },async endpoint=>await assert.rejects(runModelProposal(args(endpoint,d)),/incomplete\/refused/));
  assert.equal(existsSync(d.out),false);
 }
}));
test("schema-forged model origin and changed fact mappings are rejected without files",()=>workspace(async d=>{
 const forged=payload();
 forged.origin="explicit_owner";
 await withServer((req,res)=>{
  res.writeHead(200,{"content-type":"application/json"});
  res.end(JSON.stringify(serverResponse(forged)));
 },async endpoint=>await assert.rejects(runModelProposal(args(endpoint,d)),/unexpected field/));
 assert.equal(existsSync(d.out),false);
 const wrong=payload();wrong.mappings[0].operations=["createProduct"];
 await withServer((req,res)=>{
  res.writeHead(200,{"content-type":"application/json"});
  res.end(JSON.stringify(serverResponse(wrong)));
 },async endpoint=>await assert.rejects(runModelProposal(args(endpoint,d)),/independently frozen/));
 assert.equal(existsSync(d.out),false);
}));
test("HTTP failures and redirects fail closed, with no raw provider response leakage",()=>workspace(async d=>{
 await withServer((req,res)=>{
  res.writeHead(429,{"content-type":"application/json"});res.end(JSON.stringify({error:"SECRET_DATA_NOT_FOR_LOGS"}));
 },async endpoint=>await assert.rejects(runModelProposal(args(endpoint,d)),e=>{
  assert.match(e.message,/MODEL_HTTP_FAILURE_STATUS_429/);
  assert.doesNotMatch(e.message,/SECRET_DATA_NOT_FOR_LOGS/);return true;
 }));
 await withServer((req,res)=>{res.writeHead(302,{location:"https://example.com"});res.end();},
  async endpoint=>await assert.rejects(runModelProposal(args(endpoint,d)),/MODEL_TRANSPORT_FAILURE/));
 assert.equal(existsSync(d.out),false);
}));
test("malformed and excessive provider responses are rejected without output files",()=>workspace(async d=>{
 await withServer((req,res)=>{res.writeHead(200,{"content-type":"application/json"});res.end("not JSON");},
  async endpoint=>await assert.rejects(runModelProposal(args(endpoint,d)),/JSON|Unexpected token|Unexpected end/));
 await withServer((req,res)=>{res.writeHead(200,{"content-type":"application/json"});
  res.end("a".repeat(1048577));},async endpoint=>await assert.rejects(runModelProposal(args(endpoint,d)),/oversized/));
 assert.equal(existsSync(d.out),false);
}));
test("model response cannot request tool execution",()=>workspace(async d=>{
 const answer=serverResponse(payload());
 answer.choices[0].message.tool_calls=[{id:"write",type:"function",function:{name:"deploy",arguments:"{}"}}];
 await withServer((req,res)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(answer));},
  async endpoint=>await assert.rejects(runModelProposal(args(endpoint,d)),/non-text/));
 assert.equal(existsSync(d.out),false);
}));
test("refuses pre-existing output before issuing request",()=>workspace(async d=>{
 await withServer((req,res)=>{
  res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(serverResponse(payload())));
 },async endpoint=>{
  const result=await runModelProposal(args(endpoint,d));
  assert.equal(result.status,"MODEL_RESPONSE_ADMITTED_UNVERIFIED");
  await assert.rejects(runModelProposal(args(endpoint,d)),/new\/empty/);
 });
}));
