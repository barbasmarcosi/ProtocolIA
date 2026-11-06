#!/usr/bin/env node
// R4.3 externally invoked, fresh-session coding agent.
// The model has NO repository checkout, shell, browser, oracle or network tools.
// The runner alone has bounded file operations and accesses localhost Ollama.
// One trial, at most 10 model calls; it is never a synthetic reference answer.
import {createHash} from "node:crypto";
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,join,relative,resolve,sep} from "node:path";

const input=resolve(process.argv[2]??"");
const out=resolve(process.argv[3]??"");
const model=process.env.R4_MODEL??"qwen3:4b-instruct-2507-q4_K_M";
const inference="http://127.0.0.1:11434/api/chat";
const MAX_ROUNDS=10,MAX_SOURCE=12000,MAX_DOCUMENT=22000;
const hash=x=>createHash("sha256").update(x).digest("hex");
const fail=m=>{throw Error("R4 isolated agent refused: "+m)};
const inside=(base,path)=>{const r=relative(base,path);return r!==""&&!r.startsWith(".."+sep)&&r!==".."&&!r.startsWith(sep)};
function readSafe(root,name){
  if(typeof name!=="string"||!name||name.includes("\\")||name.includes("\0")||
    name.split("/").some(p=>p===".."||p==="."||!p))fail("Unsafe relative path");
  const path=resolve(root,name);
  if(!inside(root,path))fail("Path outside isolated package");
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_DOCUMENT)
    fail("Invalid or oversized package entry");
  return readFileSync(path);
}
function fileSet(dir){
  const result=[];
  function walk(p,prefix){
    for(const d of readdirSync(p,{withFileTypes:true})){
      if(d.isSymbolicLink())fail("Symlink in participant bundle");
      const name=prefix?prefix+"/"+d.name:d.name;
      if(!/^[\w.-]+$/.test(d.name))fail("Unsafe entry");
      if(d.isDirectory())walk(join(p,d.name),name);
      else if(d.isFile())result.push(name);
      else fail("Unsupported package object");
    }
  }
  walk(dir,"");
  return result.sort();
}
function verifyPackage(){
  const lock=JSON.parse(readSafe(input,"HANDOFF.lock.json"));
  if(lock.schemaVersion!=="r4-public-handoff/v1"||
    !/^[a-f0-9]{64}$/.test(lock.originalContractSha256)||
    !lock.files||typeof lock.files!=="object"||Array.isArray(lock.files))
      fail("Invalid original handoff lock");
  const files=fileSet(input).filter(x=>x!=="HANDOFF.lock.json");
  if(JSON.stringify(files)!==JSON.stringify(Object.keys(lock.files).sort()))
    fail("Unexpected participant bundle file set");
  for(const name of files){
    if(hash(readSafe(input,name))!==lock.files[name])fail("Modified package byte: "+name);
  }
  const required=["AGENT_TASK.md","CHANGE_REQUEST.md","PROJECT_HANDOFF.md",
    "protocolia-contract-source/contracts/main.tsp",
    "protocolia-contract-source/tspconfig.yaml"];
  for(const n of required)if(!files.includes(n))fail("Missing participant source "+n);
  if(files.some(s=>/(^|\/)(oracle|solution|answer|scorer|secret)(\/|\.|$)/i.test(s)))
    fail("Assessor material in participant package");
  return {lock,files};
}
if(existsSync(out))fail("Output directory must not exist");
const pack=verifyPackage();
mkdirSync(join(out,"candidate","contracts"),{recursive:true,mode:0o700});
writeFileSync(join(out,"candidate","tspconfig.yaml"),
  readSafe(input,"protocolia-contract-source/tspconfig.yaml"),{flag:"wx",mode:0o600});
const cand=join(out,"candidate");
let finished=false,rounds=0;
const usage={prompt_tokens:0,completion_tokens:0,total_tokens:0};
const audit=[];
const names=pack.files;
const tools=[
  {type:"function",function:{name:"read_file",
    description:"Read one file from the immutable handoff package, with exact relative path. No repository or network access.",
    parameters:{type:"object",properties:{path:{type:"string"}},required:["path"]}}},
  {type:"function",function:{name:"write_candidate",
    description:"Write exactly one output: contracts/main.tsp (complete editable TypeSpec) or handoff-response.json (complete JSON). Does not modify handoff.",
    parameters:{type:"object",properties:{path:{type:"string"},content:{type:"string"}},
      required:["path","content"]}}},
  {type:"function",function:{name:"check_candidate",
    description:"Check whether both required files exist, whether response is valid JSON, and show a small diff summary. Not the hidden evaluator.",
    parameters:{type:"object",properties:{},required:[]}}},
  {type:"function",function:{name:"finish",
    description:"Submit the completed candidate TypeSpec and response for independent evaluation.",
    parameters:{type:"object",properties:{summary:{type:"string"}},required:["summary"]}}}
];
function check(){
  const source=join(cand,"contracts/main.tsp"),reply=join(cand,"handoff-response.json");
  if(!existsSync(source)||!existsSync(reply))
    return {valid:false,reason:"Both contracts/main.tsp and handoff-response.json must exist"};
  let parsed;
  try{parsed=JSON.parse(readFileSync(reply,"utf8"))}
  catch{return {valid:false,reason:"handoff-response.json is not valid JSON"}}
  const text=readFileSync(source,"utf8");
  if(text.length<500||text.length>MAX_SOURCE)return {valid:false,reason:"TypeSpec size invalid"};
  const old=readSafe(input,"protocolia-contract-source/contracts/main.tsp").toString("utf8");
  const original=old.split("\n"),updated=text.split("\n");
  const added=updated.filter(line=>!original.includes(line)).slice(0,8);
  const removed=original.filter(line=>!updated.includes(line)).slice(0,8);
  return {valid:true,responseSchema:parsed.schemaVersion,
    originalContractSha256:pack.lock.originalContractSha256,
    addedLines:added,removedLines:removed,
    warning:"Static inspection only. The hidden evaluator has not run."};
}
function perform(name,args){
  if(name==="read_file"){
    if(!names.includes(args.path))return {error:"File not present in original participant package"};
    const contents=readSafe(input,args.path).toString("utf8");
    return {path:args.path,content:contents};
  }
  if(name==="write_candidate"){
    if(!["contracts/main.tsp","handoff-response.json"].includes(args.path))
      return {error:"Only candidate TypeSpec and response are writable"};
    if(typeof args.content!=="string"||!args.content||
      args.content.length>(args.path.endsWith(".tsp")?MAX_SOURCE:9000))
      return {error:"Invalid or oversized candidate content"};
    writeFileSync(join(cand,args.path),args.content,{mode:0o600});
    return {saved:true,path:args.path,sha256:hash(args.content),bytes:args.content.length};
  }
  if(name==="check_candidate")return check();
  if(name==="finish"){
    const result=check();
    if(!result.valid)return {error:"Cannot finish: "+result.reason};
    finished=true;
    return {acceptedForAssessment:true,summary:String(args.summary??"").slice(0,350)};
  }
  return {error:"Tool not permitted"};
}
const messages=[
  {role:"system",content:"You are a newly initialized independent TypeSpec maintainer. You have no earlier conversations or repository access. Your entire working context consists ONLY of participant handoff files accessible through read_file. Do not guess material business policies. The supplied instructions may be incomplete: disclose unknowns. You may edit only the candidate files with write_candidate; no shell, GitHub, browser, terminal or network tools exist. Read the task, source, and relevant Passport before changing anything. Preserve all unauthorized behavior. Finish by calling finish. Never claim a human approved something."},
  {role:"user",content:"Cold handoff. Start by reading AGENT_TASK.md, CHANGE_REQUEST.md, and protocolia-contract-source/contracts/main.tsp, then relevant Passport docs as helpful. Deliver a complete replacement TypeSpec under contracts/main.tsp plus handoff-response.json. Original contract SHA-256: "+pack.lock.originalContractSha256+". Available participant file names (the oracle is NOT provided): "+names.join(", ")+". You have at most "+MAX_ROUNDS+" model turns."}
];
const started=new Date().toISOString();
let errored=null;
try{
  for(let i=0;i<MAX_ROUNDS&&!finished;i++){
    rounds++;
    const request={model,messages,tools,stream:false,think:false,
      options:{temperature:0.1,num_ctx:16384,num_predict:3600},
      keep_alive:"25m"};
    const res=await fetch(inference,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(request),signal:AbortSignal.timeout(480000)});
    const raw=await res.text();
    if(!res.ok)fail("Local Ollama returned HTTP "+res.status+" "+
      raw.slice(0,280).replace(/\s+/g," "));
    let data;
    try{data=JSON.parse(raw)}
    catch{fail("Invalid Ollama JSON (HTTP "+res.status+"): "+
      raw.slice(0,140).replace(/\s+/g," "))}
    const msg=data.message;
    if(!msg||msg.role!=="assistant")fail("Local model response missing assistant message");
    usage.prompt_tokens+=Number(data.prompt_eval_count??0);
    usage.completion_tokens+=Number(data.eval_count??0);
    usage.total_tokens+=Number(data.prompt_eval_count??0)+Number(data.eval_count??0);
    const calls=msg.tool_calls??[];
    audit.push({turn:i+1,finishReason:data.done_reason??null,
      toolNames:calls.map(c=>c.function?.name),toolCallCount:calls.length});
    if(calls.length>12)fail("Excessive tool calls in one turn: "+calls.length);
    if(audit.reduce((n,entry)=>n+entry.toolCallCount,0)>48)
      fail("Bounded agent exceeded 48 total file-tool calls");
    messages.push({role:"assistant",content:msg.content??"",
      ...(calls.length?{tool_calls:calls}:{})});
    if(calls.length===0){
      messages.push({role:"user",content:"Use the exposed tools to save both files. Finish only with finish after check_candidate."});
      continue;
    }
    for(const call of calls){
      let args=call.function.arguments??{};
      if(typeof args==="string"){
        try{args=JSON.parse(args)}catch{args={}}
      }
      const reply=perform(call.function.name,args);
      messages.push({role:"tool",tool_name:call.function.name,content:JSON.stringify(reply)});
    }
  }
  if(!finished)fail("Model did not finish candidate within bounded turns");
  const result=check();
  if(!result.valid)fail("Candidate incomplete after finish");
  console.log("PROTOCOLIA_R4_EXTERNAL_TOOL_USING_MODEL_SUBMITTED "+
    JSON.stringify({model,rounds,usage,contractSha256:pack.lock.originalContractSha256,
      toolCallCount:audit.reduce((n,x)=>n+x.toolCallCount,0)}));
}catch(e){
  errored=String(e.message??e);
  console.error("PROTOCOLIA_R4_EXTERNAL_AGENT_TRIAL_FAILED "+errored.slice(0,750));
}finally{
  const metadata={schemaVersion:"r4-external-model-trial/v1",
    model,provider:"Ollama (local CPU)",endpoint:"http://127.0.0.1:11434/api/chat",
    source:"fresh API chat context, no tool access outside immutable handoff",
    complete:finished&&!errored,startedAt:started,completedAt:new Date().toISOString(),
    originalContractSha256:pack.lock.originalContractSha256,
    rounds,usage,audit,error:errored};
  writeFileSync(join(out,"trial-metadata.json"),JSON.stringify(metadata,null,2)+"\n");
  // Only record tool names and usage, never full prompt/model output payload.
  // Candidate bytes are preserved as a separate output artifact.
}
if(errored)process.exitCode=1;
