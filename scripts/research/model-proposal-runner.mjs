#!/usr/bin/env node
// R2.2 model-only agent proposal runner: one bounded Chat Completions request.
// No tools/functions, shell commands, model-owned source files, or automatic approvals.
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,lstatSync} from "node:fs";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {admitProposal,checkBrief,promptForBrief} from "./agent-intake-gateway.mjs";

const sha=x=>createHash("sha256").update(x).digest("hex");
function assert(ok,reason){if(!ok)throw Error(reason);}
function object(x){return x!==null&&typeof x==="object"&&!Array.isArray(x);}
function boundedFile(path){
 const s=lstatSync(resolve(path));
 assert(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=262144,"unsafe brief file");
 return readFileSync(resolve(path));
}
function targetUrl(value,authenticated){
 assert(typeof value==="string"&&value.length<=500,"invalid endpoint");
 const u=new URL(value);
 const localhost=u.hostname==="127.0.0.1"||u.hostname==="localhost"||u.hostname==="[::1]";
 assert(u.protocol==="https:"||u.protocol==="http:"&&localhost,"endpoint must use HTTPS or loopback HTTP");
 assert(!u.username&&!u.password&&!u.hash&&!u.search,"endpoint must not contain credentials, fragment or query");
 assert(u.pathname.endsWith("/chat/completions"),"expected explicit chat/completions endpoint");
 assert(!authenticated||u.protocol==="https:","secrets may only travel over HTTPS");
 return u;
}
function strictUsage(v){
 if(v===undefined)return null;
 assert(object(v),"malformed model usage");
 const result={};
 for(const field of ["prompt_tokens","completion_tokens","total_tokens"]){
  if(v[field]!==undefined){
   assert(Number.isSafeInteger(v[field])&&v[field]>=0&&v[field]<=10000000,"invalid token usage");
   result[field]=v[field];
  }
 }
 return result;
}
async function boundedResponse(response,max=1048576){
 if(!response.ok)throw Error("MODEL_HTTP_FAILURE_STATUS_"+response.status);
 const declared=response.headers.get("content-length");
 if(declared!==null)assert(Number.isSafeInteger(+declared)&&+declared<=max,"oversized model response");
 assert(response.body,"missing model response body");
 const reader=response.body.getReader();
 let size=0;const chunks=[];
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;assert(size<=max,"oversized model response");
   chunks.push(value);
  }
 }finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks,size).toString("utf8");
}
function parseReply(raw){
 let response;
 try{response=JSON.parse(raw);}catch{throw Error("invalid completion JSON");}
 assert(object(response)&&Array.isArray(response.choices)&&response.choices.length===1,"unexpected completion response");
 const item=response.choices[0];
 assert(item.finish_reason==="stop","incomplete/refused/tool-using completion");
 assert(object(item.message)&&item.message.role==="assistant"&&!item.message.tool_calls&&!item.message.function_call,"non-text model output");
 assert(typeof item.message.content==="string"&&item.message.content.length>0&&item.message.content.length<=262144,"invalid text model content");
 let proposal;
 try{proposal=JSON.parse(item.message.content);}catch{throw Error("invalid proposal JSON");}
 assert(object(proposal),"model proposal must be a JSON object");
 return {proposal,usage:strictUsage(response.usage),
  responseId:typeof response.id==="string"&&response.id.length<=160?response.id:null,
  modelReported:typeof response.model==="string"&&response.model.length<=160?response.model:null,
  fingerprint:typeof response.system_fingerprint==="string"&&response.system_fingerprint.length<=160?response.system_fingerprint:null};
}
function validateOpts(options){
 assert(object(options),"invalid run config");
 assert(typeof options.briefPath==="string"&&typeof options.outPath==="string","brief and out required");
 assert(typeof options.model==="string"&&/^[A-Za-z0-9_.:/-]{2,100}$/.test(options.model),"invalid model ID");
 assert(options.networkApproved===true,"external model request requires explicit --network-approved");
 const key=options.apiKey;
 assert(key===undefined||typeof key==="string"&&key.length>0&&key.length<=4096,"invalid key");
 const endpoint=targetUrl(options.endpoint,key!==undefined);
 const maxTokens=options.maxOutputTokens??1800;
 assert(Number.isSafeInteger(maxTokens)&&maxTokens>=128&&maxTokens<=4096,"max output tokens outside bounded research budget");
 const timeout=options.timeoutMs??30000;
 assert(Number.isSafeInteger(timeout)&&timeout>=1000&&timeout<=90000,"invalid request timeout");
 const out=resolve(options.outPath),brief=resolve(options.briefPath);
 assert(out!==brief&&!out.startsWith(brief+"/"),"output aliases source");
 if(existsSync(out))assert(lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink()&&readdirSync(out).length===0,
  "output must be a new/empty directory");
 return {endpoint,maxTokens,timeout,out,brief};
}
export async function runModelProposal(options,transport=fetch){
 const c=validateOpts(options);
 const source=boundedFile(c.brief),brief=checkBrief(JSON.parse(source.toString("utf8")));
 const prompt=promptForBrief(c.brief); // includes SHA of the source bytes
 assert(sha(boundedFile(c.brief))===sha(source),"brief mutated during prompt creation");
 const request={
  model:options.model,
  messages:[
   {role:"system",content:"You are a requirements analyst. Produce one JSON object only. No tools, code execution or invented owner authority. Preserve every source fact; report uncertainties and deferred hypotheses."},
   {role:"user",content:prompt}
  ],
  response_format:{type:"json_object"},
  stream:false,
  max_completion_tokens:c.maxTokens,
  n:1
 };
 const headers={"content-type":"application/json","accept":"application/json"};
 if(options.apiKey)headers.authorization="Bearer "+options.apiKey;
 const start=performance.now();
 let response;
 try{
  response=await transport(c.endpoint.toString(),{
   method:"POST",redirect:"error",headers,body:JSON.stringify(request),
   signal:AbortSignal.timeout(c.timeout)
  });
 }catch(e){throw Error("MODEL_TRANSPORT_FAILURE_"+(e?.name==="TimeoutError"?"TIMEOUT":"UNAVAILABLE"));}
 const raw=await boundedResponse(response);
 const durationMs=Math.round(performance.now()-start);
 const {proposal,usage,responseId,modelReported,fingerprint}=parseReply(raw);
 // No file is written until the independent source gateway accepts the proposal.
 const result=admitProposal(brief,proposal,sha(source),sha(Buffer.from(JSON.stringify(proposal))));
 const record={
  schemaVersion:"protocolia-model-run/v0.1",
  status:"MODEL_RESPONSE_ADMITTED_UNVERIFIED",
  transport:"openai-compatible-chat-completions",
  adapter:"model-only-no-tools",
  requestedModel:options.model,reportedModel:modelReported,
  endpointOrigin:c.endpoint.origin, // no API keys, queries or full path
  sourceSha256:sha(source),proposalSha256:sha(Buffer.from(JSON.stringify(proposal))),
  responseId,modelFingerprint:fingerprint,usage,durationMs,
  requestCount:1,retryCount:0,requestedMaxOutputTokens:c.maxTokens,
  costUsd:"UNKNOWN_UNPRICED",credentialInRecord:false,
  caveats:[
   "Actual model/provider identity is not independently authenticated",
   "No permission to deploy or perform external actions was issued",
   "Agent claims, owner provenance and semantic completeness are NOT independently verified",
   "A model response is not a measured comparison of multiple workflow harnesses"
  ]
 };
 mkdirSync(c.out,{recursive:true,mode:0o700});
 const files=new Map([
  ["proposal.json",JSON.stringify(proposal,null,2)+"\n"],
  ["intake.json",JSON.stringify(result.intake,null,2)+"\n"],
  ["source-provenance.json",JSON.stringify(result.provenance,null,2)+"\n"],
  ["model-run.json",JSON.stringify(record,null,2)+"\n"]
 ]);
 for(const [name,body] of files)writeFileSync(join(c.out,name),body,{flag:"wx",mode:0o600});
 return {status:record.status,sourceSha256:record.sourceSha256,proposalSha256:record.proposalSha256,
  usage,reportedModel:modelReported,durationMs,costUsd:"UNKNOWN_UNPRICED"};
}
function optionsFromCli(argv){
 assert(argv[0]==="run","usage: model-proposal-runner.mjs run --brief PATH --out DIR --endpoint HTTPS_CHAT_COMPLETIONS --model MODEL --network-approved [--key-env VAR]");
 const o={networkApproved:false};const allowed=new Set(["--brief","--out","--endpoint","--model","--key-env","--max-output-tokens","--timeout-ms"]);
 for(let i=1;i<argv.length;i++){
  const arg=argv[i];
  if(arg==="--network-approved"){assert(!o.networkApproved,"duplicate network flag");o.networkApproved=true;continue;}
  assert(allowed.has(arg)&&argv[i+1]&&!argv[i+1].startsWith("--")&&o[arg]===undefined,"unexpected or duplicate option");
  o[arg]=argv[++i];
 }
 let key;
 if(o["--key-env"]!==undefined){
  assert(/^[A-Z][A-Z0-9_]{2,80}$/.test(o["--key-env"]),"invalid key environment variable");
  key=process.env[o["--key-env"]];
  assert(typeof key==="string"&&key.length>0,"required API key not configured");
 }
 return {briefPath:o["--brief"],outPath:o["--out"],endpoint:o["--endpoint"],model:o["--model"],
  apiKey:key,networkApproved:o.networkApproved,
  ...(o["--max-output-tokens"]!==undefined?{maxOutputTokens:Number(o["--max-output-tokens"])}:{}),
  ...(o["--timeout-ms"]!==undefined?{timeoutMs:Number(o["--timeout-ms"])}:{})};
}
export async function main(argv){const r=await runModelProposal(optionsFromCli(argv));process.stdout.write(JSON.stringify(r,null,2)+"\n");}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main(process.argv.slice(2));}
 catch(e){process.stderr.write("MODEL_PROPOSAL_REJECTED: "+String(e.message).slice(0,180)+"\n");process.exitCode=1;}
}
