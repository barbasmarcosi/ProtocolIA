// P2 state-only workflow: two mutually exclusive decisions; no external effects.
// Source-specified stage labels are checked, while operations and permissions are sealed.
const fail=s=>{throw Error("REVIEW_IR_INVALID: "+s);};
const check=(ok,s)=>{if(!ok)fail(s);};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function exact(x,keys,name){check(obj(x)&&Object.keys(x).length===keys.length&&
  Object.keys(x).every(k=>keys.includes(k)),name+" unknown or absent fields");}
const validState=s=>typeof s==="string"&&/^[a-z][a-z0-9_]{1,30}$/.test(s);
const q=JSON.stringify;
export function reviewSemanticIr(source){
 exact(source,["schemaVersion","profile","namespace","title","bounds","workflow"],"source");
 check(source.schemaVersion==="protocolia-review-workflow-source/v0.1"&&
  source.profile==="review-case-workflow/v0"&&source.namespace==="ReviewWorkflowLab","profile");
 check(typeof source.title==="string"&&source.title.length>=3&&source.title.length<=120&&
  source.title.trim()===source.title&&!/[\u0000-\u001f\u007f]/.test(source.title),"title");
 exact(source.bounds,["caseIdMaxLength","summaryMaxLength"],"bounds");
 const b=source.bounds,w=source.workflow;
 check(Number.isSafeInteger(b.caseIdMaxLength)&&b.caseIdMaxLength>=12&&b.caseIdMaxLength<=120,"id max");
 check(Number.isSafeInteger(b.summaryMaxLength)&&b.summaryMaxLength>=12&&b.summaryMaxLength<=255,"summary max");
 exact(w,["initial","review","accepted","rejected"],"workflow");
 const labels=Object.values(w);
 check(labels.every(validState)&&new Set(labels).size===4,"state labels distinct and valid");
 const edges=[
  ["submitReviewCase","submit",w.initial,w.review,"cases.review"],
  ["approveReviewCase","approve",w.review,w.accepted,"cases.decide"],
  ["rejectReviewCase","reject",w.review,w.rejected,"cases.decide"]
 ];
 const op=(name,kind,path,capability)=>({name,kind,entity:"ReviewCase",path,capability});
 const operations=[
  op("createReviewCase","create","/api/review-cases","cases.write"),
  op("getReviewCase","get","/api/review-cases/{caseId}","cases.read"),
  op("listReviewCases","listPage","/api/review-cases","cases.read"),
  ...edges.map(([name,action,from,to,capability])=>({
   ...op(name,"transition","/api/review-cases/{caseId}/"+action,capability),
   field:"state",from,to,audit:["state"]})),
  op("health","health","/health","public")
 ];
 return {schemaVersion:"protocolia-typed-state-ir/v0.1",profile:source.profile,
  namespace:source.namespace,title:source.title,sourceBounds:{...b},workflow:{...w},
  entities:[{name:"ReviewCase",view:"Review cases",publicIdentity:"caseId",
   fields:[
    {name:"caseId",type:"string",minLength:1,maxLength:b.caseIdMaxLength,unique:true},
    {name:"summary",type:"string",minLength:1,maxLength:b.summaryMaxLength},
    {name:"state",type:"string",initial:w.initial}
   ]}],operations};
}
export function validateReviewSemanticIr(ir){
 exact(ir,["schemaVersion","profile","namespace","title","sourceBounds","workflow","entities","operations"],"IR");
 const canonical=reviewSemanticIr({schemaVersion:"protocolia-review-workflow-source/v0.1",
  profile:ir.profile,namespace:ir.namespace,title:ir.title,
  bounds:ir.sourceBounds,workflow:ir.workflow});
 check(ir.schemaVersion===canonical.schemaVersion&&q(ir)===q(canonical),
  "IR differs from trusted state graph");
 return ir;
}
export function emitReviewTypeSpec(ir){
 validateReviewSemanticIr(ir);
 const b=ir.sourceBounds,w=ir.workflow;
 const transitions=ir.operations.filter(o=>o.kind==="transition").map(o=>[
  "  @route("+q(o.path)+")",
  "  @post",
  '  @behavior("transition", "ReviewCase", "state")',
  "  @transition("+q(o.from)+", "+q(o.to)+")",
  '  @audit("state")',
  "  @capability("+q(o.capability)+")",
  "  op "+o.name+"(@path caseId: string):",
  "    ReviewCase | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;",""
 ].join("\n"));
 return [
  'import "@typespec/http";','import "@protocolia/domain";',
  "using TypeSpec.Http;","using ProtocolIA.Domain;","",
  "@service(#{ title: "+q(ir.title)+" })","namespace ReviewWorkflowLab {",
  "  @entity",'  @view("Review cases")',
  "  model ReviewCase {",
  "    @publicIdentity","    @unique","    @minLength(1)","    @maxLength("+b.caseIdMaxLength+")",
  "    caseId: string;",
  "    @minLength(1)","    @maxLength("+b.summaryMaxLength+")",
  "    summary: string;","    @initial("+q(w.initial)+")","    state: string;","  }",
  "  model ReviewCaseRequest {",
  "    @minLength(1) @maxLength("+b.caseIdMaxLength+") caseId: string;",
  "    @minLength(1) @maxLength("+b.summaryMaxLength+") summary: string;","  }",
  "  model ReviewCasePage {",
  "    items: ReviewCase[];",
  "    @minValue(1) @maxValue(50) limit: int32;",
  "    @minValue(0) offset: int32;",
  "    @minValue(0) total: int32;","  }",
  "  model Health { status: string; }",
  "  @error model NotFound { @statusCode _: 404; message: string; }",
  "  @error model Conflict { @statusCode _: 409; message: string; }",
  "  @error model BadRequest { @statusCode _: 400; message: string; }",
  "  @error model Unauthorized { @statusCode _: 401; message: string; }",
  "  @error model Forbidden { @statusCode _: 403; message: string; }",
  '  @route("/api/review-cases")',"  @post",
  '  @behavior("create", "ReviewCase")','  @capability("cases.write")',
  "  op createReviewCase(@body input: ReviewCaseRequest):",
  "    { @statusCode _: 201; @body item: ReviewCase; } | Conflict | BadRequest | Unauthorized | Forbidden;",
  '  @route("/api/review-cases/{caseId}")',"  @get",
  '  @behavior("get", "ReviewCase")','  @capability("cases.read")',
  "  op getReviewCase(@path caseId: string): ReviewCase | NotFound | Unauthorized | Forbidden;",
  '  @route("/api/review-cases")',"  @get",
  '  @behavior("listPage", "ReviewCase")','  @capability("cases.read")',
  "  op listReviewCases(",
  "    @query @minValue(1) @maxValue(50) limit?: int32 = 25,",
  "    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0",
  "  ): ReviewCasePage | BadRequest | Unauthorized | Forbidden;",
  ...transitions,
  '  @route("/health")',"  @get",'  @behavior("health", "ReviewCase")',
  '  @capability("public")',"  op health(): Health;","}",""
 ].join("\n");
}
