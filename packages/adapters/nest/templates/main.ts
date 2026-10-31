import {Controller,Get,Inject,Injectable,Module,NestModule,RequestMapping,RequestMethod,Req,Res} from "@nestjs/common";
import {NestFactory} from "@nestjs/core";
import {NestExpressApplication} from "@nestjs/platform-express";
import {createHash,timingSafeEqual} from "node:crypto";
import {createRemoteJWKSet,jwtVerify} from "jose";
import {existsSync,readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {Pool} from "pg";
import {installBff,installBffSecurityHeaders} from "./BffSession";
import "reflect-metadata";
import contract from "./manifest.json";

type Field={name:string;column:string;ownerManaged?:boolean;readCapability?:string;type:string;required:boolean;nullable:boolean;unique:boolean;computedSum?:string[];computedProduct?:[string,string];computedRoundedProduct?:{left:string;right:string;mode:"half_up"};computedDiscountedTotal?:{price:string;quantity:string;discount:string;mode:"half_up"};min?:number;max?:number;minLength?:number;maxLength?:number;pattern?:string;choices?:Array<{value:string;label:string}>;reference?:{target:string;onDelete:string};initial?:string;requiredWhen?:{field:string;equals:string};forbidWhen?:{field:string;equals:string};decimal?:{precision:number;scale:number;min?:string;max?:string};afterField?:string;greaterThanField?:string};
type Entity={name:string;table:string;publicIdentity:string;identityColumn:string;fields:Field[];
 ownerRelation?:{field:string;parentTable:string;parentKey:string;parentOwnerColumn:string;parentReadCapability:string}};
type Reserve={stockTable:string;stockKeyColumn:string;availableColumn:string;referenceField:string;quantityField:string;stockWriteCapability:string};
type MoveUnits={stockTable:string;stockKeyColumn:string;availableColumn:string;sourceField:string;targetField:string;quantityField:string;maxBalance:number;parentWriteCapability:string};
type MoveBatch={stockTable:string;stockKeyColumn:string;availableColumn:string;maxBalance:number;parentWriteCapability:string;legs:{sourceField:string;targetField:string;quantityField:string}[]};
type CreateDetails={childEntity:string;parentField:string;rowsField:string;maxRows:number;childWriteCapability:string;versioned?:boolean;closeField?:string;closeState?:string};
type ReverseUnits={stockTable:string;stockKeyColumn:string;availableColumn:string;sourceColumn:string;targetColumn:string;amountColumn:string;maxBalance:number;parentWriteCapability:string};
type ExactDebit={balanceTable:string;balanceKey:string;balanceColumn:string;referenceField:string;amountField:string;parentWriteCapability:string};
type ExactReverse=ExactDebit&{referenceColumn:string;amountColumn:string;maxBalance:string};
type Release={stockTable:string;stockKeyColumn:string;availableColumn:string;referenceColumn:string;amountColumn:string;stockWriteCapability:string};
type QueryFilter={name:string;expression:string;comparator:string;type:string;minLength:number|null;maxLength:number|null;min:number|null;max:number|null;pattern:string|null};
type QuerySpec={projection:string;source:string;order:string;filters:QueryFilter[]};
type RelatedSum={sqlNest:string;sqlSpring:string;childReadCapability:string};
type ExactReconciliation=RelatedSum&{openingField:string;availableField:string};
type Operation={query?:QuerySpec;relatedSum?:RelatedSum;detailSum?:RelatedSum;exactReconciliation?:ExactReconciliation;name:string;method:string;path:string;entity:string;kind:string;capability:string;audit?:string[];reserve?:Reserve;moveUnits?:MoveUnits;moveBatch?:MoveBatch;createDetails?:CreateDetails;reverseBatch?:MoveBatch;reverseUnits?:ReverseUnits;release?:Release;exactDebit?:ExactDebit;exactReverse?:ExactReverse;field?:string;input?:string;from?:string;to?:string;inputMin?:number;inputMax?:number;limitDefault?:number;limitMin?:number;limitMax?:number;offsetDefault?:number;offsetMax?:number};
type Manifest={entities:Entity[];operations:Operation[];readCapabilities:string[];writeCapabilities:string[];auditCapabilities:string[];assignmentCapabilities:string[];fieldReadCapabilities?:string[];hasOverdueRules?:boolean};
const spec=contract as Manifest;
type FieldIssue={field:string;code:string};
class Problem extends Error{
  constructor(public readonly status:number,message:string,public readonly issues?:FieldIssue[]){super(message);}
}
function invalidField(field:Field,code:string):Problem{
  return new Problem(400,"Validation failed",[{field:field.name,code}]);
}
function sendProblem(res:any,error:unknown):void{
  if(error instanceof Problem){
    res.status(error.status).json({statusCode:error.status,message:error.message,
      ...(error.issues?{issues:error.issues}:{})});
    return;
  }
  const pgError=error as {code?:string};
  const status=pgError?.code==="23505"?409:
    pgError?.code==="23503"?400:
    ["23502","23514","22P02","22008"].includes(pgError?.code??"")?400:500;
  if(status===500)console.error("PROTOCOLIA_NEST_UNEXPECTED_ERROR",error);
  res.status(status).json({statusCode:status,message:status===500?"Internal server error":"Database constraint violation"});
}
function isRecord(value:unknown):value is Record<string,unknown>{
  return !!value&&typeof value==="object"&&!Array.isArray(value);
}
function safeIdentifier(value:string):string{
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(value))throw Error("Unsafe SQL identifier: "+value);
  return value;
}
function checkString(value:unknown,f:Field):boolean{
  return typeof value==="string"&&value.trim().length>0&&
    value.length>=(f.minLength??0)&&value.length<=(f.maxLength??255)&&
    (f.pattern===undefined||new RegExp(f.pattern).test(value));
}
// Exact base-10 wire values are strings; never convert via IEEE-754 Number.
function decimalUnits(value:string,scale:number):bigint{
  const neg=value.startsWith("-");
  const [whole,fraction=""]=(neg?value.slice(1):value).split(".");
  return BigInt((neg?"-":"")+whole+fraction.padEnd(scale,"0"));
}
function decimalIssue(value:unknown,f:Field):string|null{
  if(typeof value!=="string")return "invalid_type";
  const d=f.decimal;
  if(!d||value.length>d.precision+d.scale+4||
    !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value))return "invalid_format";
  const unsigned=value.replace(/^-/,"");
  const [whole,fraction=""]=unsigned.split(".");
  if(whole.replace(/^0+/,"").length>d.precision-d.scale)return "out_of_range";
  if(fraction.length>d.scale)return "invalid_format";
  const scaled=decimalUnits(value,d.scale);
  if(d.min!==undefined&&scaled<decimalUnits(d.min,d.scale))return "out_of_range";
  if(d.max!==undefined&&scaled>decimalUnits(d.max,d.scale))return "out_of_range";
  return null;
}
function parseTimestamp(value:unknown):string{
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Problem(400,"Invalid date-time");
  const date=new Date(value);
  if(!Number.isFinite(date.valueOf()))throw new Problem(400,"Invalid date-time");
  return date.toISOString();
}
function validateInput(e:Entity,body:unknown,writable:string[],create:boolean):Record<string,unknown>{
  if(!isRecord(body))throw new Problem(400,"Expected JSON object");
  if(Object.keys(body).some(key=>!writable.includes(key)))throw new Problem(400,"Unknown field");
  if(create)for(const f of e.fields)
    if(f.required&&f.initial===undefined&&!f.computedSum&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal&&!Object.hasOwn(body,f.name))
      throw invalidField(f,"required");
  if(create)for(const f of e.fields){
    if(!f.requiredWhen||body[f.requiredWhen.field]!==f.requiredWhen.equals)continue;
    const candidate=body[f.name];
    if(typeof candidate!=="string"||!candidate.trim())throw invalidField(f,"required");
  }
  if(create)for(const f of e.fields){
    if(f.forbidWhen&&body[f.forbidWhen.field]===f.forbidWhen.equals&&Object.hasOwn(body,f.name))
      throw invalidField(f,"invalid_combination");
  }
  for(const [key,value] of Object.entries(body)){
    const f=e.fields.find(x=>x.name===key);
    if(!f)throw new Problem(400,"Unknown field");
    if(create&&f.initial!==undefined&&value!==f.initial)throw invalidField(f,"invalid_initial");
    if(value===null){if(!f.nullable)throw invalidField(f,"required");continue;}
    if(f.type==="string"&&!checkString(value,f))throw invalidField(f,typeof value==="string"?"invalid_format":"invalid_type");
    if(f.type==="string"&&f.choices?.length&&!f.choices.some(c=>c.value===value))
      throw invalidField(f,"invalid_choice");
    if(f.type==="int32"&&(!Number.isInteger(value)||(value as number)<-2147483648||
       (value as number)>2147483647||(f.min!==undefined&&(value as number)<f.min)||
       (f.max!==undefined&&(value as number)>f.max)))throw invalidField(f,Number.isInteger(value)?"out_of_range":"invalid_type");
    if(f.type==="decimal"){
      const error=decimalIssue(value,f);if(error)throw invalidField(f,error);
    }
    if(f.type==="utcDateTime"){
      try{parseTimestamp(value);}catch{throw invalidField(f,"invalid_format");}
    }
  }
  if(create)for(const f of e.fields){
    if(!f.afterField)continue;
    const strict=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
    if(typeof body[f.afterField]!=="string"||!strict.test(body[f.afterField] as string))
      throw invalidField(e.fields.find(x=>x.name===f.afterField)!,"invalid_format");
    if(body[f.name]===undefined)continue;
    if(typeof body[f.name]!=="string"||!strict.test(body[f.name] as string))
      throw invalidField(f,"invalid_format");
    const end=parseTimestamp(body[f.name]);
    const start=parseTimestamp(body[f.afterField]);
    if(Date.parse(end)<=Date.parse(start))throw invalidField(f,"invalid_order");
  }
  if(create)for(const f of e.fields){
    if(!f.greaterThanField||body[f.name]===undefined)continue;
    const source=body[f.greaterThanField];
    const start=e.fields.find(x=>x.name===f.greaterThanField)!;
    if(f.type==="decimal"){
      const endValue=body[f.name] as string,startValue=source as string;
      const scale=Math.max(f.decimal!.scale,start.decimal!.scale);
      const end=decimalUnits(endValue,f.decimal!.scale)*10n**BigInt(scale-f.decimal!.scale);
      const begin=decimalUnits(startValue,start.decimal!.scale)*10n**BigInt(scale-start.decimal!.scale);
      if(end<=begin)throw invalidField(f,"invalid_comparison");
    }else{
      if(typeof source!=="number"||!Number.isInteger(source))throw invalidField(start,"invalid_type");
      if((body[f.name] as number)<=source)throw invalidField(f,"invalid_comparison");
    }
  }
  return body;
}
function equalSecrets(a:string,b:string):boolean{
  const aa=createHash("sha256").update(a).digest(),bb=createHash("sha256").update(b).digest();
  return timingSafeEqual(aa,bb);
}
@Injectable()
class RuntimeService{
  private readonly pool:Pool;
  private readonly migrationPool:Pool|null;
  private readonly jwtConfig:{issuer:string;audience:string;verify:ReturnType<typeof createRemoteJWKSet>}|null;
  private readonly browserAuth:{mode:"demo"|"jwt";enabled:boolean;issuer?:string;authorizationEndpoint?:string;tokenEndpoint?:string;clientId?:string;redirectUri?:string;scope?:string;requireIssuerResponse?:boolean;requireIdToken?:boolean};
  private readonly scopedUser:{username:string;password:string;capabilities:string[]}|null=null;
  private readonly entities=new Map<string,Entity>(spec.entities.map(e=>[e.name,e]));
  constructor(){
    const source=(process.env.PROTOCOLIA_JDBC_URL??"").replace(/^jdbc:/,"");
    if(!/^postgres(?:ql)?:\/\//.test(source))throw Error("PostgreSQL connection required");
    const connection=new URL(source);
    if(!connection.username)connection.username=process.env.PROTOCOLIA_JDBC_USER??"";
    if(!connection.password)connection.password=process.env.PROTOCOLIA_JDBC_PASSWORD??"";
    if(!connection.username)throw Error("PostgreSQL username must be explicit");
    this.pool=new Pool({connectionString:connection.toString(),max:20});
    const migrationUser=process.env.PROTOCOLIA_MIGRATION_JDBC_USER??"";
    const migrationPassword=process.env.PROTOCOLIA_MIGRATION_JDBC_PASSWORD??"";
    if(Boolean(migrationUser)!==Boolean(migrationPassword))
      throw Error("Both explicit migration DB user and password must be configured together");
    if(migrationUser){
      if(migrationUser===connection.username)
        throw Error("Explicit migration DB principal must differ from runtime principal");
      const migration=new URL(source);
      migration.username=migrationUser;
      migration.password=migrationPassword;
      this.migrationPool=new Pool({connectionString:migration.toString(),max:2});
    }else this.migrationPool=null;
    const mode=process.env.PROTOCOLIA_AUTH_MODE??"demo";
    if(!["demo","jwt"].includes(mode))throw Error("Unsupported ProtocolIA authentication mode");
    if(mode==="jwt"){
      if(process.env.PROTOCOLIA_ALLOW_DEMO_AUTH==="true")throw Error("JWT mode cannot enable demo credentials");
      const issuer=process.env.PROTOCOLIA_JWT_ISSUER??"",audience=process.env.PROTOCOLIA_JWT_AUDIENCE??"";
      const jwks=process.env.PROTOCOLIA_JWT_JWKS_URI??"";
      let issuerUrl:URL,jwksUrl:URL;
      try{issuerUrl=new URL(issuer);jwksUrl=new URL(jwks);}catch{throw Error("JWT issuer and JWKS URL required");}
      const testHttp=process.env.PROTOCOLIA_JWT_ALLOW_TEST_HTTP==="true";
      if(!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,190}$/.test(audience)||
        !["https:",...(testHttp?["http:"]:[])].includes(issuerUrl.protocol)||
        !["https:",...(testHttp?["http:"]:[])].includes(jwksUrl.protocol)||
        issuerUrl.username||issuerUrl.password||jwksUrl.username||jwksUrl.password||
        issuerUrl.hash||issuerUrl.search||jwksUrl.hash||jwksUrl.search||issuer.length>300||jwks.length>500)
        throw Error("Invalid JWT issuer, audience or trusted JWKS URL");
      this.jwtConfig={issuer,audience,verify:createRemoteJWKSet(jwksUrl,{
        timeoutDuration:5000,cacheMaxAge:60000,cooldownDuration:1000})};
    }else this.jwtConfig=null;
    this.browserAuth=this.browserAuthConfig(mode);
    if(process.env.PROTOCOLIA_ALLOW_DEMO_AUTH==="true")
      for(const key of ["PROTOCOLIA_READER_USERNAME","PROTOCOLIA_READER_PASSWORD",
        "PROTOCOLIA_MANAGER_USERNAME","PROTOCOLIA_MANAGER_PASSWORD"])
        if(!process.env[key])throw Error("Missing demo credential: "+key);
    if(process.env.PROTOCOLIA_ALLOW_DEMO_AUTH==="true"&&process.env.PROTOCOLIA_READER_USERNAME?.toLowerCase()===process.env.PROTOCOLIA_MANAGER_USERNAME?.toLowerCase())
      throw Error("Demo subjects must be distinct");
    const scopedKeys=["PROTOCOLIA_SCOPED_USERNAME","PROTOCOLIA_SCOPED_PASSWORD","PROTOCOLIA_SCOPED_CAPABILITIES"] as const;
    if(scopedKeys.some(key=>(process.env[key]??"").trim().length>0)){
      if(process.env.PROTOCOLIA_ALLOW_DEMO_AUTH!=="true"||
        scopedKeys.some(key=>!(process.env[key]??"").trim()))
        throw Error("Incomplete test-only scoped credentials");
      const username=process.env.PROTOCOLIA_SCOPED_USERNAME!,password=process.env.PROTOCOLIA_SCOPED_PASSWORD!;
      if(password.length<16||[process.env.PROTOCOLIA_READER_USERNAME,process.env.PROTOCOLIA_MANAGER_USERNAME]
        .some(name=>name!.toLowerCase()===username.toLowerCase()))
        throw Error("Unsafe scoped test credential");
      const capabilities=process.env.PROTOCOLIA_SCOPED_CAPABILITIES!.split(",").map(x=>x.trim());
      const known=new Set([...spec.readCapabilities,...spec.writeCapabilities,...
        (spec.auditCapabilities??[]),...(spec.assignmentCapabilities??[]),...(spec.fieldReadCapabilities??[])]);
      if(capabilities.length>16||new Set(capabilities).size!==capabilities.length||
        capabilities.some(cap=>cap==="public"||!known.has(cap)))
        throw Error("Invalid scoped test authority allowlist");
      this.scopedUser={username,password,capabilities:capabilities.sort()};
    }
    for(const e of spec.entities){
      safeIdentifier(e.table);safeIdentifier(e.identityColumn);
      for(const f of e.fields)safeIdentifier(f.column);
    }
  }
  // Opt-in in-process poller. Persisted inbox/outbox survive process downtime;
  // hosting which sleeps needs an external wake-up source for delivery SLAs.
  async tickOverdueInbox():Promise<void>{
    const result=await this.pool.query(
      "SELECT enqueued,dispatched FROM protocolia_tick_notifications($1::timestamptz,$2::integer)",
      [new Date().toISOString(),25]);
    console.log("PROTOCOLIA_ALERT_TICK "+JSON.stringify(result.rows[0]));
  }
  private async verifyOidcDiscovery():Promise<void>{
    const policy=process.env.PROTOCOLIA_OIDC_DISCOVERY_REQUIRED??"false";
    if(policy!=="true"&&policy!=="false")throw Error("Invalid OIDC discovery policy");
    if(policy==="false")return;
    if(!this.jwtConfig||!this.browserAuth.enabled)
      throw Error("OIDC discovery requires configured JWT browser PKCE");
    const issuer=this.jwtConfig.issuer,base=new URL(issuer);
    if(base.search||base.hash||base.username||base.password)
      throw Error("Unsafe OIDC issuer");
    // The discovery URL comes only from the operator-pinned issuer, never user input.
    const discovery=issuer.replace(/\/$/,"")+"/.well-known/openid-configuration";
    let document:any;
    try{
      const response=await fetch(discovery,{method:"GET",redirect:"error",
        headers:{Accept:"application/json"},signal:AbortSignal.timeout(4000),cache:"no-store"});
      if(!response.ok||!response.headers.get("content-type")?.toLowerCase().includes("application/json"))
        throw Error("Invalid OIDC discovery response");
      const reader=response.body?.getReader();
      if(!reader)throw Error("Empty OIDC discovery document");
      const fragments:Uint8Array[]=[];let length=0;
      try{
        while(true){
          const next=await reader.read();
          if(next.done)break;
          length+=next.value.byteLength;
          if(length>32768)throw Error("Oversized OIDC metadata");
          fragments.push(next.value);
        }
      }finally{await reader.cancel().catch(()=>{});}
      const bytes=new Uint8Array(length);let offset=0;
      for(const fragment of fragments){bytes.set(fragment,offset);offset+=fragment.length;}
      document=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    }catch{throw Error("OIDC discovery unavailable or invalid; refusing startup");}
    if(!document||Array.isArray(document)||typeof document!=="object")
      throw Error("Invalid OIDC discovery document");
    const expected={
      issuer,authorization_endpoint:this.browserAuth.authorizationEndpoint!,
      token_endpoint:this.browserAuth.tokenEndpoint!,
      jwks_uri:process.env.PROTOCOLIA_JWT_JWKS_URI!
    };
    for(const [field,value] of Object.entries(expected))
      if(typeof document[field]!=="string"||document[field]!==value)
        throw Error("OIDC discovery metadata mismatch: "+field);
    if(!Array.isArray(document.response_types_supported)||
       !document.response_types_supported.includes("code")||
       !Array.isArray(document.code_challenge_methods_supported)||
       !document.code_challenge_methods_supported.includes("S256")||
       document.authorization_response_iss_parameter_supported!==true)
      throw Error("OIDC provider does not advertise required PKCE/issuer response support");
    this.browserAuth.requireIssuerResponse=true;
  }
  async init():Promise<void>{
    await this.verifyOidcDiscovery();
    const connection=await (this.migrationPool??this.pool).connect();
    try{
      await connection.query("BEGIN");
      await connection.query("SELECT pg_advisory_xact_lock(7219, 3006)");
      await connection.query("CREATE TABLE IF NOT EXISTS protocolia_schema_history (digest VARCHAR(64) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      const sql=readFileSync(join(process.cwd(),"src/schema.sql"),"utf8");
      const digest=createHash("sha256").update(sql).digest("hex");
      const history=await connection.query("SELECT digest FROM protocolia_schema_history");
      if(history.rows.length===0){
        await connection.query(sql);
        await connection.query("INSERT INTO protocolia_schema_history (digest) VALUES ($1)",[digest]);
      }else if(history.rows.length!==1||history.rows[0].digest!==digest)
        throw Error("ProtocolIA Nest schema drift detected; refusing startup");
      // Migrations use a separate, immutable and checksummed journal.
      // Bootstrap/upgrade and its journal commit atomically under the same DB advisory lock.
      await connection.query("CREATE TABLE IF NOT EXISTS protocolia_nest_migration_history (version INTEGER PRIMARY KEY CHECK (version >= 2), checksum VARCHAR(64) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      const folder=join(process.cwd(),"src/migrations");
      const names=existsSync(folder)?readdirSync(folder):[];
      if(names.some(name=>!/^V[2-9][0-9]*__[A-Za-z0-9_-]+\.sql$/.test(name)))
        throw Error("Unsupported Nest migration file; refusing startup");
      const releases=names.map(name=>({
        name,version:Number(name.match(/^V([0-9]+)__/)[1])
      })).sort((a,b)=>a.version-b.version);
      const ledger=await connection.query("SELECT version,checksum FROM protocolia_nest_migration_history ORDER BY version");
      if(ledger.rows.length>releases.length)
        throw Error("Nest database is newer than this application's migrations");
      for(let i=0;i<releases.length;i++){
        const migration=releases[i];
        if(!Number.isSafeInteger(migration.version)||migration.version!==i+2)
          throw Error("Nonsequential Nest migration versions");
        const patch=readFileSync(join(folder,migration.name),"utf8");
        const checksum=createHash("sha256").update(patch).digest("hex");
        if(i<ledger.rows.length){
          if(ledger.rows[i].version!==migration.version||ledger.rows[i].checksum!==checksum)
            throw Error("ProtocolIA Nest migration checksum/history drift detected");
        }else{
          await connection.query(patch);
          await connection.query("INSERT INTO protocolia_nest_migration_history (version,checksum) VALUES ($1,$2)",[migration.version,checksum]);
          console.log("PROTOCOLIA_NEST_MIGRATION_APPLIED "+migration.version);
        }
      }
      if(process.env.PROTOCOLIA_MIGRATION_FAILPOINT==="before-commit")
        throw Error("PROTOCOLIA_TEST_MIGRATION_INTERRUPTED_BEFORE_COMMIT");
      await connection.query("COMMIT");
      if(process.env.PROTOCOLIA_MIGRATION_FAILPOINT==="after-commit")
        throw Error("PROTOCOLIA_TEST_MIGRATION_INTERRUPTED_AFTER_COMMIT");
      // Disposable CI SIGKILL barrier after the schema transaction is durable.
      // Timeout must fail without issuing a runtime handoff if no kill arrives.
      if(process.env.PROTOCOLIA_MIGRATION_FAILPOINT==="pause-after-commit"){
        console.log("PROTOCOLIA_TEST_MIGRATION_PAUSED_AFTER_COMMIT");
        await new Promise<void>(ok=>setTimeout(ok,120000));
        throw Error("PROTOCOLIA_TEST_MIGRATION_PAUSE_NOT_INTERRUPTED");
      }
      const handoff=(process.env.PROTOCOLIA_MIGRATION_HANDOFF_ID??"");
      if(handoff){
        if(!/^[0-9a-f]{64}$/.test(handoff))
          throw Error("Invalid one-shot handoff digest");
        const runtimeUser=process.env.PROTOCOLIA_HANDOFF_RUNTIME_USER??"";
        if(!/^[a-z][a-z0-9_]{1,62}$/.test(runtimeUser))
          throw Error("Invalid SQL runtime handoff principal");
        await connection.query("CREATE TABLE IF NOT EXISTS public.protocolia_migration_handoff_v1 "+
          "(image_digest varchar(64) PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT NOW())");
        await connection.query("INSERT INTO public.protocolia_migration_handoff_v1 (image_digest) "+
          "VALUES ($1) ON CONFLICT (image_digest) DO NOTHING",[handoff]);
        await connection.query("GRANT SELECT ON public.protocolia_migration_handoff_v1 TO "+runtimeUser);
        console.log("PROTOCOLIA_NEST_MIGRATION_HANDOFF_PUBLISHED");
      }
    }catch(e){await connection.query("ROLLBACK");throw e;}
    finally{
      connection.release();
      if(this.migrationPool)await this.migrationPool.end();
    }
    if(this.migrationPool){
      const runtime=await this.pool.connect();
      try{
        const who=await runtime.query("SELECT current_user AS principal");
        if(who.rows[0]?.principal===process.env.PROTOCOLIA_MIGRATION_JDBC_USER)
          throw Error("Runtime DB principal must never equal migration principal");
        console.log("PROTOCOLIA_NEST_SPLIT_DB_PRINCIPALS_OK");
      }finally{runtime.release();}
    }
  }
  async verifyRuntimeReady():Promise<void>{
    if(this.migrationPool||
       (process.env.PROTOCOLIA_MIGRATION_JDBC_USER??"")!==""||
       (process.env.PROTOCOLIA_MIGRATION_JDBC_PASSWORD??"")!=="")
      throw Error("HTTP runtime must never receive privileged migration credentials");
    const db=await this.pool.connect();
    try{
      const who=await db.query("SELECT rolsuper FROM pg_roles WHERE rolname=current_user");
      if(who.rows.length!==1||who.rows[0].rolsuper!==false)
        throw Error("HTTP runtime SQL principal must not be a superuser");
      const handoff=process.env.PROTOCOLIA_MIGRATION_HANDOFF_ID??"";
      if(!/^[0-9a-f]{64}$/.test(handoff))
        throw Error("Runtime missing exact staged image migration handoff");
      const release=await db.query(
        "SELECT image_digest FROM public.protocolia_migration_handoff_v1 WHERE image_digest=$1",
        [handoff]);
      if(release.rows.length!==1)
        throw Error("Runtime refused incomplete or different migration handoff");
      for(const entity of spec.entities){
        const result=await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
          [entity.table]);
        const columns=new Set(result.rows.map((row:{column_name:string})=>row.column_name));
        for(const field of entity.fields)
          if(!columns.has(field.column))
            throw Error("Runtime schema is not migrated for "+entity.table+"."+field.column);
      }
      console.log("PROTOCOLIA_NEST_RUNTIME_SCHEMA_READY");
    }finally{db.release();}
  }
  async closePools():Promise<void>{
    if(this.migrationPool)await this.migrationPool.end();
    await this.pool.end();
  }
  private browserAuthConfig(mode:string):typeof this.browserAuth{
    if(mode!=="jwt")return {mode:"demo",enabled:false};
    const keys=["PROTOCOLIA_OIDC_AUTHORIZATION_ENDPOINT","PROTOCOLIA_OIDC_TOKEN_ENDPOINT",
      "PROTOCOLIA_OIDC_CLIENT_ID","PROTOCOLIA_OIDC_REDIRECT_URI"] as const;
    const vals=keys.map(key=>(process.env[key]??"").trim());
    if(vals.every(value=>!value))return {mode:"jwt",enabled:false};
    if(vals.some(value=>!value))throw Error("Incomplete OAuth2 PKCE browser configuration");
    const [authorizationEndpoint,tokenEndpoint,clientId,redirectUri]=vals;
    const permitted=["https:",...(process.env.PROTOCOLIA_JWT_ALLOW_TEST_HTTP==="true"?["http:"]:[])];
    const safe=(value:string,redirect=false)=>{
      let url:URL;try{url=new URL(value);}catch{throw Error("Invalid PKCE URL");}
      if(!permitted.includes(url.protocol)||!url.hostname||url.username||url.password||
        url.hash||url.search||value.length>500||(redirect&&url.pathname!=="/"))
        throw Error("Unsafe PKCE browser endpoint");
      return url;
    };
    safe(authorizationEndpoint);safe(tokenEndpoint);safe(redirectUri,true);
    const proofPolicy=process.env.PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED??"false";
    if(!["true","false"].includes(proofPolicy))throw Error("Invalid OIDC ID token policy");
    if(proofPolicy==="true"&&process.env.PROTOCOLIA_OIDC_DISCOVERY_REQUIRED!=="true")
      throw Error("OIDC ID token proof requires strict issuer discovery");
    const scope=(process.env.PROTOCOLIA_OIDC_SCOPE??"openid profile").trim();
    if(!/^[A-Za-z0-9_.:-]+(?: [A-Za-z0-9_.:-]+){0,12}$/.test(scope)||
      !/^[A-Za-z0-9_.:-]{3,128}$/.test(clientId))throw Error("Invalid PKCE client or scope");
    if(proofPolicy==="true"&&!scope.split(" ").includes("openid"))
      throw Error("OIDC ID token proof requires openid scope");
    return {mode:"jwt",enabled:true,issuer:this.jwtConfig!.issuer,
      authorizationEndpoint,tokenEndpoint,clientId,redirectUri,scope,
      requireIdToken:proofPolicy==="true"};
  }
  oidcConfig():typeof this.browserAuth{return this.browserAuth;}
  bffPool():Pool{return this.pool;}
  authConfig():typeof this.browserAuth|{mode:"bff";enabled:true}{
    return process.env.PROTOCOLIA_BFF_ENABLED==="true"?{mode:"bff",enabled:true}:this.browserAuth;
  }
  async login(req:any):Promise<{username:string;capabilities:string[]}>{
    if(this.jwtConfig){
      const auth=req.headers.authorization;
      const segments=typeof auth==="string"&&auth.startsWith("Bearer ")?auth.slice(7).split("."):[];
      if(segments.length!==3||segments.some(segment=>!/^[A-Za-z0-9_-]+$/.test(segment)))
        throw new Problem(401,"Bearer token required");
      try{
        const {payload,protectedHeader}=await jwtVerify(auth.slice(7),this.jwtConfig.verify,{
          issuer:this.jwtConfig.issuer,audience:this.jwtConfig.audience,algorithms:["RS256"],
          clockTolerance:30,requiredClaims:["exp","iat","sub"]});
        const subject=payload.sub,raw=payload.protocolia_capabilities;
        const allowed=new Set([...spec.readCapabilities,...spec.writeCapabilities,
          ...(spec.auditCapabilities??[]),...(spec.assignmentCapabilities??[]),...(spec.fieldReadCapabilities??[])]);
        if(protectedHeader.alg!=="RS256"||typeof subject!=="string"||!subject.trim()||
          subject.length>128||!Array.isArray(raw)||raw.length>16||
          new Set(raw).size!==raw.length||raw.some(v=>typeof v!=="string"||v==="public"||!allowed.has(v)))
          throw Error("Untrusted JWT capability or subject");
        return {username:subject,capabilities:[...raw].sort()};
      }catch{throw new Problem(401,"Invalid bearer token");}
    }
    if(process.env.PROTOCOLIA_ALLOW_DEMO_AUTH!=="true")throw new Problem(401,"Authentication required");
    const auth=req.headers.authorization;
    if(typeof auth!=="string"||!/^Basic [A-Za-z0-9+/=]+$/.test(auth))
      throw new Problem(401,"Authentication required");
    let credential:string;
    try{credential=Buffer.from(auth.slice(6),"base64").toString("utf8");}
    catch{throw new Problem(401,"Invalid credentials");}
    const split=credential.indexOf(":");
    if(split<0)throw new Problem(401,"Invalid credentials");
    const username=credential.slice(0,split),password=credential.slice(split+1);
    const m=process.env.PROTOCOLIA_MANAGER_USERNAME!,r=process.env.PROTOCOLIA_READER_USERNAME!;
    const manager=equalSecrets(username,m)&&equalSecrets(password,process.env.PROTOCOLIA_MANAGER_PASSWORD!);
    const reader=equalSecrets(username,r)&&equalSecrets(password,process.env.PROTOCOLIA_READER_PASSWORD!);
    const scoped=this.scopedUser;
    const limited=!!scoped&&equalSecrets(username,scoped.username)&&equalSecrets(password,scoped.password);
    if(!manager&&!reader&&!limited)throw new Problem(401,"Invalid credentials");
    if(limited)return {username,capabilities:[...scoped!.capabilities]};
    return {username,capabilities:manager?[...new Set([...spec.readCapabilities,...spec.writeCapabilities,...(spec.auditCapabilities??[]),...(spec.assignmentCapabilities??[]),...(spec.fieldReadCapabilities??[])])].sort():
      [...spec.readCapabilities].sort()};
  }
  async me(req:any,res:any):Promise<void>{
    try{
      const session=await this.login(req);
      if(this.browserAuth.requireIdToken&&!req.protocoliaBffAuthenticated){
        const idToken=req.headers["x-protocolia-id-token"];
        const nonce=req.headers["x-protocolia-oidc-nonce"];
        if(typeof idToken!=="string"||idToken.length>16384||
           typeof nonce!=="string"||!/^[A-Za-z0-9_-]{43,}$/.test(nonce))
          throw new Problem(401,"OIDC identity proof required");
        try{
          const {payload,protectedHeader}=await jwtVerify(idToken,this.jwtConfig!.verify,{
            issuer:this.jwtConfig!.issuer,audience:this.browserAuth.clientId!,
            algorithms:["RS256"],requiredClaims:["exp","iat","sub"]
          });
          const audience=payload.aud;
          const audiences=typeof audience==="string"?[audience]:audience;
          // Constrain this profile to exactly the public SPA client_id as audience.
          // Identity and authorized API grants remain separate.
          if(protectedHeader.alg!=="RS256"||
             !Array.isArray(audiences)||audiences.length!==1||
             audiences[0]!==this.browserAuth.clientId||
             (payload.azp!==undefined&&payload.azp!==this.browserAuth.clientId)||
             payload.nonce!==nonce||payload.sub!==session.username||
             typeof payload.iat!=="number"||
             payload.iat<Math.floor(Date.now()/1000)-600||
             payload.iat>Math.floor(Date.now()/1000)+60)
            throw Error("Invalid OIDC ID token claims");
          // Optional at_hash is mandatory to verify when provided in code-flow ID Tokens.
          if(payload.at_hash!==undefined){
            const accessToken=req.headers.authorization?.slice(7);
            const hash=createHash("sha256").update(accessToken??"").digest().subarray(0,16).toString("base64url");
            if(payload.at_hash!==hash)throw Error("Invalid ID token access-token binding");
          }
        }catch{throw new Problem(401,"Invalid OIDC identity proof");}
      }
      res.status(200).json(session);
    }catch(e){sendProblem(res,e);}
  }
  private async inbox(e:Entity,op:Operation,req:any,subject:string):Promise<unknown>{
    const read=op.kind==="inboxPage",query=req.query??{};
    if(req.body!==undefined&&req.body!==null||Object.keys(query).some(k=>!read||!["limit","offset"].includes(k)))
      throw new Problem(400,"Unexpected inbox input");
    const values:unknown[]=["demo-basic",subject];
    let suffix:string;
    if(read){
      const integer=(raw:unknown,fallback:number)=>{
        if(raw===undefined)return fallback;
        if(typeof raw!=="string"||!/^[0-9]+$/.test(raw))throw new Problem(400,"Invalid pagination");
        const n=Number(raw);if(!Number.isSafeInteger(n))throw new Problem(400,"Invalid pagination");return n;
      };
      const limit=integer(query.limit,25),offset=integer(query.offset,0);
      if(limit<1||limit>50||offset<0||offset>1000000)throw new Problem(400,"Invalid pagination");
      values.push(limit,offset);suffix="_page($1::text,$2::text,$3::integer,$4::integer)";
    }else{
      const id=req.params?.notificationId;
      if(typeof id!=="string"||!/^[1-9][0-9]{0,18}$/.test(id)||BigInt(id)>9223372036854775807n)
        throw new Problem(400,"Invalid notification id");
      values.push(id);suffix="_ack($1::text,$2::text,$3::bigint)";
    }
    try{
      const result=await this.pool.query("SELECT protocolia_inbox_"+e.table+suffix+" AS value",values);
      return result.rows[0].value;
    }catch(error){
      const code=(error as {code?:string}).code;
      if(code==="42501")throw new Problem(403,"Recipient identity is not provisioned");
      if(code==="P0002")throw new Problem(404,"Notification not found");
      if(code==="22023")throw new Problem(400,"Invalid inbox input");
      throw error;
    }
  }
  private select(e:Entity):string{
    const versioned=spec.operations.some(op=>op.entity===e.name&&op.createDetails?.versioned);
    return "SELECT "+e.fields.map(f=>f.column+' AS "'+f.name+'"').join(",")+
      (versioned?',document_version AS "documentVersion"':"")+" FROM "+e.table;
  }
  private parseDocumentVersion(ifMatch:unknown):number{
    if(typeof ifMatch!=="string"||!/^"[1-9][0-9]{0,9}"$/.test(ifMatch))
      throw new Problem(400,"Expected a strong If-Match document version");
    const version=Number(ifMatch.slice(1,-1));
    if(!Number.isInteger(version)||version>2147483647)
      throw new Problem(400,"Invalid document version");
    return version;
  }
  private async assertDocumentVersion(client:any,parent:Entity,id:string,ifMatch:unknown):Promise<void>{
    const expected=this.parseDocumentVersion(ifMatch);
    const plan=spec.operations.find(op=>op.entity===parent.name&&op.createDetails?.versioned)
      ?.createDetails;
    const field=plan?.closeField?parent.fields.find(f=>f.name===plan.closeField):undefined;
    const locked=await client.query("SELECT document_version"+
      (field?","+field.column+' AS "documentState"':"")+" FROM "+parent.table+
      " WHERE "+parent.identityColumn+"=$1 FOR UPDATE",[id]);
    if(locked.rowCount!==1)throw new Problem(404,"Versioned document not found");
    if(locked.rows[0].document_version!==expected)
      throw new Problem(409,"Stale document version");
    if(plan?.closeState&&locked.rows[0].documentState===plan.closeState)
      throw new Problem(409,"Document is closed");
  }
  private async bumpDocumentVersion(client:any,parent:Entity,id:string):Promise<void>{
    const changed=await client.query("UPDATE "+parent.table+
      " SET document_version=document_version+1 WHERE "+parent.identityColumn+
      "=$1 AND document_version<2147483647",[id]);
    if(changed.rowCount!==1)throw new Problem(409,"Document version exhausted");
  }
  private async row(e:Entity,id:string,subject?:string):Promise<Record<string,unknown>>{
    const owner=e.fields.find(f=>f.ownerManaged);
    if(owner&&!subject)throw new Problem(403,"Owner identity is required");
    const response=await this.pool.query(this.select(e)+" WHERE "+e.identityColumn+"=$1"+
      (owner?" AND "+owner.column+"=$2":""),owner?[id,subject]:[id]);
    if(!response.rows.length)throw new Problem(404,"Not found");
    return response.rows[0];
  }
  private async sumDetails(op:Operation,id:string):Promise<{totalUnits:string}>{
    const plan=op.detailSum;
    if(!plan)throw new Error("Missing generated full detail sum");
    const result=await this.pool.query(plan.sqlNest,[id]);
    if(!result.rows.length)throw new Problem(404,"Parent not found");
    return {totalUnits:String(result.rows[0].totalUnits)};
  }
  private async sumRelated(op:Operation,id:string):Promise<{totalUnits:string}>{
    const plan=op.relatedSum;
    if(!plan)throw new Error("Missing compiled related aggregate");
    // A single SELECT is an MVCC snapshot of parent plus active children.
    // No JS Number arithmetic, and SQL identifiers are validated by the generator.
    const result=await this.pool.query(plan.sqlNest,[id]);
    if(!result.rows.length)throw new Problem(404,"Parent not found");
    return {totalUnits:String(result.rows[0].totalUnits)};
  }
  private async page(e:Entity,op:Operation,query:Record<string,unknown>,subject?:string):Promise<unknown>{
    if(Object.keys(query).some(k=>!["limit","offset"].includes(k)))throw new Problem(400,"Unknown query");
    function integer(value:unknown,def:number):number{
      if(value===undefined)return def;
      if(typeof value!=="string"||!/^[-]?[0-9]+$/.test(value))throw new Problem(400,"Invalid page bounds");
      const number=Number(value);
      if(!Number.isSafeInteger(number))throw new Problem(400,"Invalid page bounds");
      return number;
    }
    const limit=integer(query.limit,op.limitDefault??25),offset=integer(query.offset,op.offsetDefault??0);
    if(limit<(op.limitMin??1)||limit>(op.limitMax??50)||offset<0||offset>(op.offsetMax??1000000))
      throw new Problem(400,"Invalid page bounds");
    const owner=e.fields.find(f=>f.ownerManaged);
    if(owner&&!subject)throw new Problem(403,"Owner identity is required");
    const clause=owner?" WHERE "+owner.column+"=$1":"";
    const [items,count]=await Promise.all([
      this.pool.query(this.select(e)+clause+" ORDER BY "+e.identityColumn+
        (owner?" LIMIT $2 OFFSET $3":" LIMIT $1 OFFSET $2"),owner?[subject,limit,offset]:[limit,offset]),
      this.pool.query("SELECT COUNT(*)::integer AS total FROM "+e.table+clause,owner?[subject]:[])
    ]);
    return {items:items.rows,total:count.rows[0].total,limit,offset};
  }
  private async queryPage(entity:Entity,op:Operation,query:Record<string,unknown>):Promise<unknown>{
    const plan=op.query;
    if(!plan)throw new Error("Missing generated query plan");
    const allowed=new Set(["limit","offset",...plan.filters.map(f=>f.name)]);
    if(Object.keys(query).some(k=>!allowed.has(k)))throw new Problem(400,"Unknown query parameter");
    const intBound=(value:unknown,fallback:number)=>{
      if(value===undefined)return fallback;
      if(typeof value!=="string"||!/^[0-9]+$/.test(value))throw new Problem(400,"Invalid pagination");
      const number=Number(value);
      if(!Number.isSafeInteger(number))throw new Problem(400,"Invalid pagination");
      return number;
    };
    const limit=intBound(query.limit,op.limitDefault??25);
    const offset=intBound(query.offset,op.offsetDefault??0);
    if(limit<(op.limitMin??1)||limit>(op.limitMax??50)||offset<0||offset>(op.offsetMax??1000000))
      throw new Problem(400,"Invalid pagination");
    const values:unknown[]=[];
    let clause=" WHERE TRUE";
    const lower=new Map<string,number>(),upper=new Map<string,number>();
    for(const filter of plan.filters){
      if(!Object.hasOwn(query,filter.name))continue;
      const raw=query[filter.name];
      if(typeof raw!=="string")throw new Problem(400,"Invalid filter input");
      let value:unknown=raw;
      if(filter.type==="string"){
        if(!raw.trim()||(filter.minLength!=null&&raw.length<filter.minLength)||
           (filter.maxLength!=null&&raw.length>filter.maxLength)||
           (filter.pattern!=null&&!new RegExp(filter.pattern).test(raw)))
          throw new Problem(400,"Invalid string filter");
      }else if(filter.type==="int32"){
        if(!/^-?[0-9]+$/.test(raw))throw new Problem(400,"Invalid integer filter");
        const num=Number(raw);
        if(!Number.isInteger(num)||num<-2147483648||num>2147483647||
           (filter.min!=null&&num<filter.min)||(filter.max!=null&&num>filter.max))
          throw new Problem(400,"Invalid integer filter");
        value=num;
      }else if(filter.type==="utcDateTime"){
        value=parseTimestamp(raw);
      }else throw new Error("Invalid generated query type");
      if(filter.comparator===">=")lower.set(filter.expression,
        filter.type==="utcDateTime"?Date.parse(String(value)):Number(value));
      if(filter.comparator==="<=")upper.set(filter.expression,
        filter.type==="utcDateTime"?Date.parse(String(value)):Number(value));
      // A literal, case-insensitive substring; SQL wildcard characters are escaped.
      if(filter.comparator==="ILIKE")value="%"+raw.replace(/!/g,"!!").replace(/%/g,"!%").replace(/_/g,"!_")+"%";
      values.push(value);
      clause+=" AND "+filter.expression+" "+filter.comparator+" $"+values.length+
        (filter.comparator==="ILIKE"?" ESCAPE '!'":"");
    }
    for(const [column,start] of lower){
      if(upper.has(column)&&start>upper.get(column)!)throw new Problem(400,"Inverted query range");
    }
    const [items,count]=await Promise.all([
      this.pool.query(plan.projection+plan.source+clause+plan.order+
        " LIMIT $"+(values.length+1)+" OFFSET $"+(values.length+2),[...values,limit,offset]),
      this.pool.query("SELECT COUNT(*)::integer AS total"+plan.source+clause,values)
    ]);
    return {items:items.rows,total:count.rows[0].total,limit,offset};
  }
  private async reconcileExact(op:Operation,key:string):Promise<Record<string,unknown>>{
    if(typeof key!=="string")throw new Problem(400,"Invalid reconciliation identity");
    const plan=op.exactReconciliation;
    if(!plan)throw new Error("Missing generated reconciliation plan");
    const result=await this.pool.query(plan.sqlNest,[key]);
    if(!result.rowCount)throw new Problem(404,"Not found");
    return result.rows[0];
  }
  private async auditPage(e:Entity,key:string,op:Operation,query:Record<string,unknown>):Promise<unknown>{
    if(typeof key!=="string"||Object.keys(query).some(x=>!["limit","offset"].includes(x)))
      throw new Problem(400,"Invalid audit query");
    const parse=(v:unknown,fallback:number)=>{
      if(v===undefined)return fallback;
      if(typeof v!=="string"||!/^[0-9]+$/.test(v))throw new Problem(400,"Invalid audit page bounds");
      const n=Number(v);
      if(!Number.isSafeInteger(n))throw new Problem(400,"Invalid audit page bounds");
      return n;
    };
    const limit=parse(query.limit,op.limitDefault??25),offset=parse(query.offset,op.offsetDefault??0);
    if(limit<(op.limitMin??1)||limit>(op.limitMax??50)||offset<0||offset>(op.offsetMax??1000000))
      throw new Problem(400,"Invalid audit page bounds");
    await this.row(e,key); // Enforce not-found only after audit capability authentication.
    const selection="SELECT id::text AS \"id\", actor, entity_name AS \"entityName\", "+
      "resource_id AS \"resourceId\", operation_name AS \"operationName\", "+
      "field_name AS \"fieldName\", before_value AS \"beforeValue\", "+
      "after_value AS \"afterValue\", "+
      "to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || "+
      "to_char(occurred_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' AS \"occurredAt\" "+
      "FROM protocolia_audit_event WHERE entity_name=$1 AND resource_id=$2";
    const [records,amount]=await Promise.all([
      this.pool.query(selection+" ORDER BY id DESC LIMIT $3 OFFSET $4",[e.name,key,limit,offset]),
      this.pool.query("SELECT COUNT(*)::integer AS total FROM protocolia_audit_event "+
        "WHERE entity_name=$1 AND resource_id=$2",[e.name,key])
    ]);
    return {items:records.rows,total:amount.rows[0].total,limit,offset};
  }
  private async recordAudit(client:any,e:Entity,op:Operation,key:string,actor:string,
    before:Record<string,unknown>|null,after:Record<string,unknown>):Promise<void>{
    for(const field of op.audit??[]){
      const old=before?.[field],next=after[field];
      await client.query("INSERT INTO protocolia_audit_event "+
        "(actor,entity_name,resource_id,operation_name,field_name,before_value,after_value) "+
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [actor,e.name,key,op.name,field,old==null?null:String(old),next==null?null:String(next)]);
    }
  }
  private async create(e:Entity,op:Operation,body:unknown,actor:string,capabilities:string[],ifMatch?:unknown):Promise<Record<string,unknown>>{
    const plan=op.createDetails;
    let detailRows:Record<string,unknown>[]|undefined;
    let child:Entity|undefined;
    if(plan){
      if(!isRecord(body)||!Array.isArray(body[plan.rowsField])||
        (body[plan.rowsField] as unknown[]).length<1||
        (body[plan.rowsField] as unknown[]).length>plan.maxRows)
        throw new Problem(400,"Expected 1..20 typed detail rows");
      child=spec.entities.find(x=>x.name===plan.childEntity);
      if(!child)throw new Problem(400,"Unresolved child entity");
      detailRows=(body[plan.rowsField] as unknown[]).map(raw=>{
        if(!isRecord(raw)||Object.hasOwn(raw,plan.parentField))
          throw new Problem(400,"Invalid nested detail row");
        const joined={...raw,[plan.parentField]:body[e.publicIdentity]};
        return validateInput(child!,joined,child!.fields.filter(f=>!f.computedSum&&
          !f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal)
          .map(f=>f.name),true);
      });
    }
    const plain=plan?{...(body as Record<string,unknown>)}:body;
    if(plan)delete (plain as Record<string,unknown>)[plan.rowsField];
    body=plain;
    const owner=e.fields.find(f=>f.ownerManaged);
    if(owner&&(!isRecord(body)||Object.hasOwn(body,owner.name)))throw new Problem(400,"Server-managed owner must not be supplied");
    if(op.moveUnits&&spec.operations.some(x=>x.entity===e.name&&x.reverseUnits)&&
      (!isRecord(body)||e.fields.some(f=>f.initial!==undefined&&Object.hasOwn(body,f.name))))
      throw new Problem(400,"Initial transfer state is server-managed");
    if(op.moveBatch&&spec.operations.some(x=>x.entity===e.name&&x.reverseBatch)&&
      (!isRecord(body)||e.fields.some(f=>f.initial!==undefined&&Object.hasOwn(body,f.name))))
      throw new Problem(400,"Initial batch state is server-managed");
    const ownedBody=owner?{...(body as Record<string,unknown>),[owner.name]:actor}:body;
    const input={...validateInput(e,ownedBody,e.fields.filter(f=>!f.computedSum&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal).map(f=>f.name),true)};
    for(const f of e.fields)if(f.initial!==undefined && !Object.hasOwn(input,f.name))
      input[f.name]=f.initial;
    const reconciled=spec.operations.find(x=>x.kind==="reconcileExact"&&x.entity===e.name)?.exactReconciliation;
    if(reconciled){
      const open=e.fields.find(f=>f.name===reconciled.openingField)!;
      const opening=decimalUnits(input[reconciled.openingField] as string,open.decimal!.scale);
      const available=decimalUnits(input[reconciled.availableField] as string,open.decimal!.scale);
      if(opening!==available)throw invalidField(e.fields.find(f=>f.name===reconciled.availableField)!,"invalid_comparison");
    }
    const persisted=e.fields.filter(f=>!f.computedSum&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal);
    const cols=persisted.map(f=>f.column);
    const params=persisted.map(f=>f.type==="utcDateTime"&&input[f.name]!=null?
      parseTimestamp(input[f.name]):input[f.name]??null);
    const relation=e.ownerRelation;
    if(relation&&!capabilities.includes(relation.parentReadCapability))
      throw new Problem(403,"Parent read capability required for linking");
    // One SQL statement atomically checks that the parent is visible to this actor.
    // The FK separately protects against concurrent parent deletion.
    const insert="INSERT INTO "+e.table+" ("+cols.join(",")+") "+
      (relation?"SELECT ":"VALUES (")+cols.map((_,i)=>"$"+(i+1)).join(",")+
      (relation?" WHERE EXISTS (SELECT 1 FROM "+relation.parentTable+" WHERE "+
        relation.parentKey+"=$"+(cols.length+1)+" AND "+relation.parentOwnerColumn+
        "=$"+(cols.length+2)+") RETURNING "+e.identityColumn:")");
    const insertParams=relation?[...params,input[relation.field],actor]:params;
    // B17: a direct child POST must not bypass @createDetails maxRows.
    // The header row lock serializes competing appends within one document.
    const boundedCreator=spec.operations.find(x=>x.createDetails?.childEntity===e.name);
    if(boundedCreator&&!capabilities.includes(boundedCreator.capability))
      throw new Problem(403,"Parent write permission required to append a detail");
    if(op.reserve||op.moveUnits||op.moveBatch||op.createDetails||op.exactDebit||op.audit?.length||boundedCreator){
      const batch=op.moveBatch;
      const movement=op.moveUnits;
      const reservation=op.reserve;
      const exactDebit=op.exactDebit;
      const balanceId=exactDebit?input[exactDebit.referenceField]:undefined;
      const money=exactDebit?input[exactDebit.amountField]:undefined;
      if(exactDebit&&(typeof balanceId!=="string"||typeof money!=="string"))
        throw new Problem(400,"Invalid exact debit input");
      const stock=reservation?input[reservation.referenceField]:undefined;
      const amount=reservation?input[reservation.quantityField]:undefined;
      if(reservation&&(typeof stock!=="string"||!Number.isInteger(amount)||(amount as number)<1))
        throw new Problem(400,"Invalid reservation input");
      // Audit and domain effects always commit or roll back on the same pinned connection.
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
        if(boundedCreator){
          const bound=boundedCreator.createDetails!;
          const parent=spec.entities.find(x=>x.name===boundedCreator.entity);
          if(!parent)throw new Error("Missing bounded detail header");
          const raw=input[bound.parentField];
          if(typeof raw!=="string"||!raw.trim())
            throw new Problem(400,"Invalid detail parent");
          const locked=await client.query("SELECT "+parent.identityColumn+" FROM "+
            parent.table+" WHERE "+parent.identityColumn+"=$1 FOR UPDATE",[raw]);
          if(locked.rowCount!==1)throw new Problem(400,"Detail parent not found");
          if(bound.versioned)await this.assertDocumentVersion(client,parent,raw,ifMatch);
          const fk=e.fields.find(x=>x.name===bound.parentField);
          if(!fk)throw new Error("Missing bounded detail relationship");
          const count=await client.query("SELECT COUNT(*)::int AS used FROM "+e.table+
            " WHERE "+fk.column+"=$1",[raw]);
          if(!count.rows.length||count.rows[0].used>=bound.maxRows)
            throw new Problem(409,"Document detail limit reached");
        }
        if(batch){
          const deltas=new Map<string,number>();
          for(const leg of batch.legs){
            const from=input[leg.sourceField],to=input[leg.targetField];
            const units=input[leg.quantityField];
            if(typeof from!=="string"||typeof to!=="string"||from===to||
              !Number.isInteger(units)||(units as number)<1)
              throw new Problem(400,"Invalid multi-leg movement");
            deltas.set(from,(deltas.get(from)??0)-(units as number));
            deltas.set(to,(deltas.get(to)??0)+(units as number));
          }
          const ids=[...deltas.keys()].sort();
          if(ids.some(id=>!id)||[...deltas.values()].some(x=>!Number.isSafeInteger(x)))
            throw new Problem(400,"Unsafe movement values");
          // Lock the union of participating accounts before any write; no per-leg lock inversion.
          const locked=await client.query("SELECT "+batch.stockKeyColumn+" FROM "+
            batch.stockTable+" WHERE "+batch.stockKeyColumn+"=ANY($1::text[]) ORDER BY "+
            batch.stockKeyColumn+" FOR UPDATE",[ids]);
          if(locked.rowCount!==ids.length)throw new Problem(400,"Movement stock account missing");
          for(const id of ids){
            const delta=deltas.get(id)!;
            if(delta===0)continue;
            const minimum=delta<0?-delta:0;
            const maximum=delta>0?batch.maxBalance-delta:batch.maxBalance;
            if(minimum>batch.maxBalance||maximum<0)
              throw new Problem(409,"Multi-leg capacity exceeded");
            const changed=await client.query("UPDATE "+batch.stockTable+" SET "+
              batch.availableColumn+"="+batch.availableColumn+"+$1 WHERE "+
              batch.stockKeyColumn+"=$2 AND "+batch.availableColumn+">=$3 AND "+
              batch.availableColumn+"<=$4",[delta,id,minimum,maximum]);
            if(changed.rowCount!==1)throw new Problem(409,"Multi-leg balance conflict");
          }
        }
        if(movement){
          const from=input[movement.sourceField],to=input[movement.targetField];
          const units=input[movement.quantityField];
          if(typeof from!=="string"||typeof to!=="string"||
              !Number.isInteger(units)||(units as number)<1||from===to)
            throw new Problem(400,"Invalid stock transfer");
          // Lock both parents in stable key order, even when concurrent moves run in reverse.
          const locked=await client.query("SELECT "+movement.stockKeyColumn+
            " FROM "+movement.stockTable+" WHERE "+movement.stockKeyColumn+
            " IN ($1,$2) ORDER BY "+movement.stockKeyColumn+" FOR UPDATE",[from,to]);
          if(locked.rowCount!==2)throw new Problem(400,"Transfer stock item missing");
          const debited=await client.query("UPDATE "+movement.stockTable+" SET "+
            movement.availableColumn+"="+movement.availableColumn+"-$1 WHERE "+
            movement.stockKeyColumn+"=$2 AND "+movement.availableColumn+">=$1",[units,from]);
          if(debited.rowCount!==1)throw new Problem(409,"Insufficient transferable units");
          const credited=await client.query("UPDATE "+movement.stockTable+" SET "+
            movement.availableColumn+"="+movement.availableColumn+"+$1 WHERE "+
            movement.stockKeyColumn+"=$2 AND "+movement.availableColumn+"<=$3",
            [units,to,movement.maxBalance-(units as number)]);
          if(credited.rowCount!==1)throw new Problem(409,"Destination capacity exceeded");
        }
        if(reservation){
        const debit=await client.query("UPDATE "+reservation.stockTable+" SET "+
          reservation.availableColumn+"="+reservation.availableColumn+"-$1 WHERE "+
          reservation.stockKeyColumn+"=$2 AND "+reservation.availableColumn+">=$1",
          [amount,stock]);
        if(!debit.rowCount){
          const existing=await client.query("SELECT 1 FROM "+reservation.stockTable+
            " WHERE "+reservation.stockKeyColumn+"=$1",[stock]);
          throw new Problem(existing.rowCount?409:400,
            existing.rowCount?"Insufficient stock":"Stock item not found");
        }
        }
        if(exactDebit){
          const result=await client.query("UPDATE "+exactDebit.balanceTable+" SET "+
            exactDebit.balanceColumn+"="+exactDebit.balanceColumn+"-$1::numeric WHERE "+
            exactDebit.balanceKey+"=$2 AND "+exactDebit.balanceColumn+">=$1::numeric",
            [money,balanceId]);
          if(!result.rowCount){
            const found=await client.query("SELECT 1 FROM "+exactDebit.balanceTable+
              " WHERE "+exactDebit.balanceKey+"=$1",[balanceId]);
            throw new Problem(found.rowCount?409:400,
              found.rowCount?"Insufficient exact balance":"Balance resource not found");
          }
        }
        const created=await client.query(insert,insertParams);
        if(relation&&!created.rowCount)throw new Problem(400,"Referenced resource unavailable");
        if(detailRows&&child){
          const writable=child.fields.filter(f=>!f.computedSum&&!f.computedProduct&&
            !f.computedRoundedProduct&&!f.computedDiscountedTotal);
          const columnNames=writable.map(f=>f.column).join(",");
          const placeholders=writable.map((_,i)=>"$"+(i+1)).join(",");
          for(const detail of detailRows){
            const params=writable.map(f=>f.type==="utcDateTime"&&detail[f.name]!=null?
              parseTimestamp(detail[f.name]):detail[f.name]??null);
            await client.query("INSERT INTO "+child.table+" ("+columnNames+") VALUES ("+
              placeholders+")",params);
          }
        }
        if(op.audit?.length)await this.recordAudit(client,e,op,String(input[e.publicIdentity]),actor,null,input);
        if(boundedCreator?.createDetails?.versioned){
          const parent=spec.entities.find(x=>x.name===boundedCreator.entity)!;
          await this.bumpDocumentVersion(client,parent,input[boundedCreator.createDetails.parentField] as string);
        }
        await client.query("COMMIT");
      }catch(error){
        await client.query("ROLLBACK");
        throw error;
      }finally{client.release();}
    }else {
      const created=await this.pool.query(insert,insertParams);
      if(relation&&!created.rowCount)throw new Problem(400,"Referenced resource unavailable");
    }
    return this.row(e,String(input[e.publicIdentity]),actor);
  }
  private async patchTogether(e:Entity,op:Operation,key:string,body:unknown,
    subject?:string):Promise<Record<string,unknown>>{
    const keys=op.input?.split(",")??[];
    if(keys.length<2||keys.length>4||new Set(keys).size!==keys.length||
       !isRecord(body)||Object.keys(body).length!==keys.length||
       keys.some(name=>!Object.hasOwn(body,name)))
      throw new Problem(400,"Expected all compound business-key fields");
    const input=validateInput(e,body,keys,false);
    const columns=keys.map(name=>e.fields.find(f=>f.name===name)!.column);
    const owner=e.fields.find(f=>f.ownerManaged);
    if(owner&&!subject)throw new Problem(403,"Owner-scoped update denied");
    const values=[...keys.map(name=>input[name]),key];
    if(owner)values.push(subject);
    const assignments=columns.map((column,index)=>column+"=$"+(index+1)).join(",");
    const updated=await this.pool.query("UPDATE "+e.table+" SET "+
      assignments+" WHERE "+e.identityColumn+"=$"+(keys.length+1)+
      (owner?" AND "+owner.column+"=$"+(keys.length+2):"")+
      " RETURNING "+e.identityColumn,values);
    if(updated.rowCount!==1)throw new Problem(404,"Not found");
    return this.row(e,key,subject);
  }

  private async patch(e:Entity,op:Operation,key:string,body:unknown,subject?:string,ifMatch?:unknown):Promise<Record<string,unknown>>{
    const audited=Boolean(op.audit?.length);
    if(!isRecord(body)||Object.keys(body).length!==(audited?2:1)||
      !Object.hasOwn(body,op.input!)||(audited&&!Object.hasOwn(body,"expected")))
      throw new Problem(400,"Unexpected patch properties");
    const input=validateInput(e,{[op.input!]:body[op.input!]},[op.input!],false);
    if(audited){
      validateInput(e,{[op.input!]:body.expected},[op.input!],false);
      if(body.expected===input[op.input!])throw new Problem(409,"New value matches previous value");
    }
    const field=e.fields.find(f=>f.name===op.field)!;
    const owner=e.fields.find(f=>f.ownerManaged);
    if(owner&&(!subject||field.ownerManaged))throw new Problem(403,"Owner-scoped patch denied");
    const versionedCreator=spec.operations.find(x=>x.createDetails?.versioned&&
      x.createDetails.childEntity===e.name);
    if(audited){
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
        let versionedParent:Entity|undefined;
        let versionedParentId:string|undefined;
        if(versionedCreator){
          const plan=versionedCreator.createDetails!;
          const fk=e.fields.find(x=>x.name===plan.parentField);
          versionedParent=spec.entities.find(x=>x.name===versionedCreator.entity);
          if(!fk||!versionedParent)throw new Error("Missing versioned parent relationship");
          const child=await client.query("SELECT "+fk.column+" FROM "+e.table+
            " WHERE "+e.identityColumn+"=$1",[key]);
          if(child.rowCount!==1)throw new Problem(404,"Detail not found");
          versionedParentId=child.rows[0][fk.column] as string;
          await this.assertDocumentVersion(client,versionedParent,versionedParentId,ifMatch);
        }
        const changed=await client.query("UPDATE "+e.table+" SET "+field.column+
          "=$1 WHERE "+e.identityColumn+"=$2 AND "+field.column+"=$3 RETURNING "+
          e.identityColumn,[input[op.input!],key,body.expected]);
        if(!changed.rowCount){
          const found=await client.query("SELECT 1 FROM "+e.table+" WHERE "+
            e.identityColumn+"=$1",[key]);
          throw new Problem(found.rowCount?409:404,found.rowCount?
            "Stale expected value":"Not found");
        }
        await this.recordAudit(client,e,op,key,subject??"",
          {[op.input!]:body.expected},input);
        if(versionedParent&&versionedParentId)
          await this.bumpDocumentVersion(client,versionedParent,versionedParentId);
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}
      finally{client.release();}
      return this.row(e,key,subject);
    }
    const changed=await this.pool.query("UPDATE "+e.table+" SET "+field.column+
      "=$1 WHERE "+e.identityColumn+"=$2"+(owner?" AND "+owner.column+"=$3":"")+
      " RETURNING "+e.identityColumn,owner?[input[op.input!],key,subject]:[input[op.input!],key]);
    if(!changed.rowCount)throw new Problem(404,"Not found");
    return this.row(e,key,subject);
  }
  private async increment(e:Entity,op:Operation,key:string,body:unknown):Promise<Record<string,unknown>>{
    if(!isRecord(body)||Object.keys(body).length!==1||
      !Object.hasOwn(body,op.input!))throw new Problem(400,"Invalid increment");
    const amount=body[op.input!];
    if(!Number.isInteger(amount)||(amount as number)<(op.inputMin??1)||
      (amount as number)>(op.inputMax??1000))throw new Problem(400,"Invalid increment");
    const col=e.fields.find(f=>f.name===op.field)!.column;
    const changed=await this.pool.query("UPDATE "+e.table+" SET "+col+"="+col+"+$1 WHERE "+
      e.identityColumn+"=$2 AND "+col+"<=2147483647-$1 RETURNING "+e.identityColumn,[amount,key]);
    if(!changed.rowCount){await this.row(e,key);throw new Problem(409,"Integer overflow");}
    return this.row(e,key);
  }
  private async transition(e:Entity,op:Operation,key:string,body:unknown,actor:string,
    ifMatch?:unknown):Promise<Record<string,unknown>>{
    if(body!==undefined&&body!==null&&(!isRecord(body)||Object.keys(body).length!==0))
      throw new Problem(400,"Transition does not accept input");
    const field=e.fields.find(f=>f.name===op.field)!;
    const creator=spec.operations.find(x=>x.entity===e.name&&x.createDetails?.versioned&&
      x.createDetails.closeField===op.field&&x.createDetails.closeState===op.to);
    if(creator){
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
        await this.assertDocumentVersion(client,e,key,ifMatch);
        const changed=await client.query("UPDATE "+e.table+" SET "+field.column+
          "=$1 WHERE "+e.identityColumn+"=$2 AND "+field.column+"=$3",
          [op.to,key,op.from]);
        if(changed.rowCount!==1)throw new Problem(409,"Document closing precondition failed");
        await this.recordAudit(client,e,op,key,actor,
          {[op.field!]:op.from},{[op.field!]:op.to});
        await this.bumpDocumentVersion(client,e,key);
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}
      finally{client.release();}
      return this.row(e,key);
    }
    if(op.reverseBatch){
      const plan=op.reverseBatch;
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
        const columns=plan.legs.flatMap(leg=>[
          leg.sourceField,leg.targetField,leg.quantityField]);
        const saved=await client.query("SELECT "+columns.join(",")+" FROM "+e.table+
          " WHERE "+e.identityColumn+"=$1",[key]);
        if(saved.rowCount!==1)throw new Problem(404,"Batch not found");
        const values=saved.rows[0] as Record<string,unknown>;
        const deltas=new Map<string,number>();
        for(const leg of plan.legs){
          const source=values[leg.sourceField],target=values[leg.targetField],
            units=values[leg.quantityField];
          if(typeof source!=="string"||typeof target!=="string"||
            !Number.isInteger(units)||(units as number)<1||source===target)
            throw new Problem(409,"Invalid persisted batch");
          deltas.set(source,(deltas.get(source)??0)+(units as number));
          deltas.set(target,(deltas.get(target)??0)-(units as number));
        }
        const ids=[...deltas.keys()].sort();
        if(ids.some(id=>!id)||[...deltas.values()].some(x=>!Number.isSafeInteger(x)))
          throw new Problem(409,"Invalid batch delta");
        // Match CREATE lock order; no child row lock may precede parent row locks.
        const locked=await client.query("SELECT "+plan.stockKeyColumn+" FROM "+
          plan.stockTable+" WHERE "+plan.stockKeyColumn+"=ANY($1::text[]) ORDER BY "+
          plan.stockKeyColumn+" FOR UPDATE",[ids]);
        if(locked.rowCount!==ids.length)throw new Problem(409,"Missing batch stock account");
        const state=await client.query("UPDATE "+e.table+" SET "+field.column+
          "=$1 WHERE "+e.identityColumn+"=$2 AND "+field.column+"=$3 RETURNING "+
          e.identityColumn,[op.to,key,op.from]);
        if(state.rowCount!==1)throw new Problem(409,"Batch already reversed");
        for(const id of ids){
          const delta=deltas.get(id)!;
          if(delta===0)continue;
          const minimum=delta<0?-delta:0;
          const maximum=delta>0?plan.maxBalance-delta:plan.maxBalance;
          if(minimum>plan.maxBalance||maximum<0)
            throw new Problem(409,"Batch reversal exceeds stock limits");
          const changed=await client.query("UPDATE "+plan.stockTable+" SET "+
            plan.availableColumn+"="+plan.availableColumn+"+$1 WHERE "+
            plan.stockKeyColumn+"=$2 AND "+plan.availableColumn+">=$3 AND "+
            plan.availableColumn+"<=$4",[delta,id,minimum,maximum]);
          if(changed.rowCount!==1)throw new Problem(409,"Cannot restore entire batch");
        }
        await this.recordAudit(client,e,op,key,actor,{[op.field!]:op.from},{[op.field!]:op.to});
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}
      finally{client.release();}
      return this.row(e,key);
    }
    if(op.reverseUnits){
      const plan=op.reverseUnits;
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
        const existing=await client.query("SELECT "+plan.sourceColumn+" AS source,"+
          plan.targetColumn+" AS target,"+plan.amountColumn+" AS units FROM "+
          e.table+" WHERE "+e.identityColumn+"=$1",[key]);
        if(!existing.rowCount)throw new Problem(404,"Not found");
        const {source,target,units}=existing.rows[0];
        if(typeof source!=="string"||typeof target!=="string"||
          source===target||!Number.isInteger(units)||units<1)
          throw new Problem(409,"Invalid stored movement");
        // Lock parent rows first, in the same order as transfers and competing reversals.
        const locked=await client.query("SELECT "+plan.stockKeyColumn+" FROM "+
          plan.stockTable+" WHERE "+plan.stockKeyColumn+" IN ($1,$2) ORDER BY "+
          plan.stockKeyColumn+" FOR UPDATE",[source,target]);
        if(locked.rowCount!==2)throw new Problem(409,"Transfer endpoint missing");
        const moved=await client.query("UPDATE "+e.table+" SET "+field.column+"=$1 WHERE "+
          e.identityColumn+"=$2 AND "+field.column+"=$3 RETURNING "+e.identityColumn,
          [op.to,key,op.from]);
        if(moved.rowCount!==1)throw new Problem(409,"Already reversed");
        const debited=await client.query("UPDATE "+plan.stockTable+" SET "+
          plan.availableColumn+"="+plan.availableColumn+"-$1 WHERE "+
          plan.stockKeyColumn+"=$2 AND "+plan.availableColumn+">=$1",[units,target]);
        if(debited.rowCount!==1)throw new Problem(409,"Destination stock no longer available");
        const credited=await client.query("UPDATE "+plan.stockTable+" SET "+
          plan.availableColumn+"="+plan.availableColumn+"+$1 WHERE "+
          plan.stockKeyColumn+"=$2 AND "+plan.availableColumn+"<=$3",
          [units,source,plan.maxBalance-units]);
        if(credited.rowCount!==1)throw new Problem(409,"Source capacity exceeded");
        await this.recordAudit(client,e,op,key,actor,{[op.field!]:op.from},{[op.field!]:op.to});
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}
      finally{client.release();}
      return this.row(e,key);
    }
    if(op.exactReverse){
      const plan=op.exactReverse;
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
        const moved=await client.query("UPDATE "+e.table+" SET "+field.column+"=$1 WHERE "+
          e.identityColumn+"=$2 AND "+field.column+"=$3 RETURNING "+
          plan.referenceColumn+" AS reference, "+plan.amountColumn+"::text AS amount",
          [op.to,key,op.from]);
        if(!moved.rowCount){
          const exists=await client.query("SELECT 1 FROM "+e.table+" WHERE "+e.identityColumn+"=$1",[key]);
          throw new Problem(exists.rowCount?409:404,exists.rowCount?"Already reversed":"Not found");
        }
        const {reference,amount}=moved.rows[0];
        const credited=await client.query("UPDATE "+plan.balanceTable+" SET "+
          plan.balanceColumn+"="+plan.balanceColumn+"+$1::numeric WHERE "+
          plan.balanceKey+"=$2 AND "+plan.balanceColumn+"<=($3::numeric-$1::numeric)",
          [amount,reference,plan.maxBalance]);
        if(credited.rowCount!==1)throw new Problem(409,"Cannot restore exact balance");
        await this.recordAudit(client,e,op,key,actor,{[op.field!]:op.from},{[op.field!]:op.to});
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}
      finally{client.release();}
      return this.row(e,key);
    }
    if(op.release){
      const release=op.release;
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
        const result=await client.query("UPDATE "+e.table+" SET "+field.column+"=$1 WHERE "+
          e.identityColumn+"=$2 AND "+field.column+"=$3 RETURNING "+
          release.referenceColumn+" AS reference, "+release.amountColumn+" AS amount",
          [op.to,key,op.from]);
        if(!result.rowCount){
          const old=await client.query("SELECT 1 FROM "+e.table+" WHERE "+e.identityColumn+"=$1",[key]);
          throw new Problem(old.rowCount?409:404,old.rowCount?"Already processed":"Not found");
        }
        const stock=result.rows[0].reference, amount=result.rows[0].amount;
        const credited=await client.query("UPDATE "+release.stockTable+" SET "+
          release.availableColumn+"="+release.availableColumn+"+$1 WHERE "+
          release.stockKeyColumn+"=$2 AND "+release.availableColumn+"<=2147483647-$1",
          [amount,stock]);
        if(credited.rowCount!==1)throw new Problem(409,"Cannot restore stock");
        if(op.audit?.length)await this.recordAudit(client,e,op,key,actor,
          {[op.field!]:op.from},{[op.field!]:op.to});
        await client.query("COMMIT");
      }catch(error){
        await client.query("ROLLBACK");
        throw error;
      }finally{client.release();}
      return this.row(e,key);
    }
    if(op.audit?.length){
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
        const changed=await client.query("UPDATE "+e.table+" SET "+field.column+"=$1 WHERE "+
          e.identityColumn+"=$2 AND "+field.column+"=$3 RETURNING "+e.identityColumn,
          [op.to,key,op.from]);
        if(!changed.rowCount){
          const exists=await client.query("SELECT 1 FROM "+e.table+" WHERE "+
            e.identityColumn+"=$1",[key]);
          throw new Problem(exists.rowCount?409:404,"Transition precondition failed");
        }
        await this.recordAudit(client,e,op,key,actor,{[op.field!]:op.from},{[op.field!]:op.to});
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}
      finally{client.release();}
      return this.row(e,key);
    }
    const changed=await this.pool.query("UPDATE "+e.table+" SET "+field.column+"=$1 WHERE "+
      e.identityColumn+"=$2 AND "+field.column+"=$3 RETURNING "+e.identityColumn,
      [op.to,key,op.from]);
    if(!changed.rowCount){await this.row(e,key);throw new Problem(409,"Transition precondition failed");}
    return this.row(e,key);
  }
  private async reassignReference(e:Entity,op:Operation,key:string,body:unknown,actor:string):Promise<Record<string,unknown>>{
    if(!isRecord(body)||Object.keys(body).length!==2||
       !Object.hasOwn(body,"expected")||!Object.hasOwn(body,op.input!))
      throw new Problem(400,"Expected previous and new reference");
    const field=e.fields.find(f=>f.name===op.field)!;
    const previous=body.expected,next=body[op.input!];
    validateInput(e,{[field.name]:previous},[field.name],false);
    validateInput(e,{[field.name]:next},[field.name],false);
    if(previous===next)throw new Problem(409,"Relation is unchanged");
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const changed=await client.query("UPDATE "+e.table+" SET "+field.column+"=$1 WHERE "+
        e.identityColumn+"=$2 AND "+field.column+"=$3 RETURNING "+e.identityColumn,
        [next,key,previous]);
      if(!changed.rowCount){
        const exists=await client.query("SELECT 1 FROM "+e.table+" WHERE "+
          e.identityColumn+"=$1",[key]);
        throw new Problem(exists.rowCount?409:404,"Reference changed or resource not found");
      }
      await this.recordAudit(client,e,op,key,actor,{[field.name]:previous},{[field.name]:next});
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
    return this.row(e,key);
  }
  private async replaceDetails(parent:Entity,key:string,body:unknown,actor:string,
      capabilities:string[],ifMatch:unknown):Promise<Record<string,unknown>>{
    const creator=spec.operations.find(x=>x.entity===parent.name&&x.createDetails?.versioned);
    const plan=creator?.createDetails;
    if(!plan)throw new Error("Unresolved versioned parent");
    const child=spec.entities.find(x=>x.name===plan.childEntity);
    const create=spec.operations.find(x=>x.entity===child?.name&&x.kind==="create");
    const remove=spec.operations.find(x=>x.entity===child?.name&&x.kind==="delete");
    if(!child||!create||!remove)throw new Error("Missing child audit operations");
    if(!capabilities.includes(creator!.capability)||!capabilities.includes(create.capability)||
       !capabilities.includes(remove.capability))
      throw new Problem(403,"Parent, child create and child delete permissions required");
    if(typeof key!=="string"||!isRecord(body)||Object.keys(body).length!==1||
       !Array.isArray(body[plan.rowsField])||
       (body[plan.rowsField] as unknown[]).length<1||
       (body[plan.rowsField] as unknown[]).length>plan.maxRows)
      throw new Problem(400,"Expected 1..20 typed replacement rows");
    const writable=child.fields.filter(f=>!f.computedSum&&!f.computedProduct&&
      !f.computedRoundedProduct&&!f.computedDiscountedTotal);
    const incoming:Record<string,unknown>[]=[];
    const identities=new Set<string>();
    for(const raw of body[plan.rowsField] as unknown[]){
      if(!isRecord(raw)||Object.hasOwn(raw,plan.parentField))
        throw new Problem(400,"The parent FK is server managed");
      const values=validateInput(child,{...raw,[plan.parentField]:key},writable.map(f=>f.name),true);
      const identity=values[child.publicIdentity];
      if(typeof identity!=="string"||identities.has(identity))
        throw new Problem(409,"Duplicate replacement identity");
      identities.add(identity);
      incoming.push(values);
    }
    const fk=child.fields.find(f=>f.name===plan.parentField);
    if(!fk)throw new Error("Unknown bounded parent FK");
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      await this.assertDocumentVersion(client,parent,key,ifMatch);
      const old=await client.query(this.select(child)+" WHERE "+fk.column+
        "=$1 ORDER BY "+child.identityColumn,[key]);
      await client.query("DELETE FROM "+child.table+" WHERE "+fk.column+"=$1",[key]);
      for(const before of old.rows)
        await this.recordAudit(client,child,remove,String(before[child.publicIdentity]),
          actor,before,{});
      const columns=writable.map(f=>f.column).join(",");
      const placeholders=writable.map((_,i)=>"$"+(i+1)).join(",");
      for(const data of incoming){
        const args=writable.map(f=>f.type==="utcDateTime"&&data[f.name]!=null?
          parseTimestamp(data[f.name]):data[f.name]??null);
        await client.query("INSERT INTO "+child.table+" ("+columns+") VALUES ("+
          placeholders+")",args);
        await this.recordAudit(client,child,create,String(data[child.publicIdentity]),
          actor,null,data);
      }
      await this.bumpDocumentVersion(client,parent,key);
      await client.query("COMMIT");
    }catch(error){
      await client.query("ROLLBACK");
      const code=(error as {code?:string}).code;
      if(code==="23503"||code==="23505")
        throw new Problem(409,"Replacement conflicts with unique or referenced resource");
      if(code==="23502"||code==="23514")
        throw new Problem(400,"Invalid replacement data");
      throw error;
    }finally{client.release();}
    return this.row(parent,key);
  }
  private async remove(e:Entity,op:Operation,key:string,actor:string,
    capabilities:string[],ifMatch:unknown,body:unknown):Promise<void>{
    if(!key||(body!=null&&(!isRecord(body)||Object.keys(body).length!==0)))
      throw new Problem(400,"DELETE must have no request body");
    const creator=spec.operations.find(x=>x.createDetails?.childEntity===e.name);
    if(!creator){
      if(op.audit?.length)throw new Error("Nonversioned audited delete is unsupported");
      try{
        const deleted=await this.pool.query("DELETE FROM "+e.table+
          " WHERE "+e.identityColumn+"=$1 RETURNING "+e.identityColumn,[key]);
        if(!deleted.rowCount)throw new Problem(404,"Not found");
      }catch(error){
        if((error as {code?:string}).code==="23503")
          throw new Problem(409,"Referenced resource cannot be deleted");
        throw error;
      }
      return;
    }
    const plan=creator.createDetails!;
    if(!plan.versioned||!op.audit?.length||!op.audit.includes(plan.parentField))
      throw new Error("Unsafe bounded detail DELETE contract");
    if(!capabilities.includes(creator.capability))
      throw new Problem(403,"Parent write permission required");
    this.parseDocumentVersion(ifMatch);
    const parent=spec.entities.find(x=>x.name===creator.entity);
    const fk=e.fields.find(x=>x.name===plan.parentField);
    if(!parent||!fk)throw new Error("Unresolved versioned detail FK");
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const childFk=await client.query("SELECT "+fk.column+" FROM "+e.table+
        " WHERE "+e.identityColumn+"=$1",[key]);
      if(childFk.rowCount!==1)throw new Problem(404,"Detail not found");
      const parentId=childFk.rows[0][fk.column] as string;
      // Same header lock as versioned append/patch. Re-check row after lock.
      await this.assertDocumentVersion(client,parent,parentId,ifMatch);
      const before=await client.query(this.select(e)+" WHERE "+e.identityColumn+
        "=$1 AND "+fk.column+"=$2",[key,parentId]);
      if(before.rowCount!==1)throw new Problem(404,"Detail changed");
      const count=await client.query("SELECT COUNT(*)::int AS total FROM "+e.table+
        " WHERE "+fk.column+"=$1",[parentId]);
      if(count.rows[0].total<=1)
        throw new Problem(409,"A bounded document requires at least one detail");
      const deleted=await client.query("DELETE FROM "+e.table+
        " WHERE "+e.identityColumn+"=$1 AND "+fk.column+"=$2",[key,parentId]);
      if(deleted.rowCount!==1)throw new Problem(409,"Detail changed concurrently");
      await this.recordAudit(client,e,op,key,actor,before.rows[0],{});
      await this.bumpDocumentVersion(client,parent,parentId);
      await client.query("COMMIT");
    }catch(error){
      await client.query("ROLLBACK");
      if((error as {code?:string}).code==="23503")
        throw new Problem(409,"Referenced resource cannot be deleted");
      throw error;
    }finally{client.release();}
  }
  async dispatch(op:Operation,req:any,res:any):Promise<void>{
    try{
      const session=await this.login(req);
      if(!session.capabilities.includes(op.capability))throw new Problem(403,"Insufficient capability");
      if(op.exactReverse&&!session.capabilities.includes(op.exactReverse.parentWriteCapability))
        throw new Problem(403,"Insufficient balance write capability");
      if(op.exactDebit&&!session.capabilities.includes(op.exactDebit.parentWriteCapability))
        throw new Problem(403,"Insufficient balance write capability");
      if(op.reserve&&!session.capabilities.includes(op.reserve.stockWriteCapability))
        throw new Problem(403,"Insufficient stock write capability");
      if(op.moveUnits&&!session.capabilities.includes(op.moveUnits.parentWriteCapability))
        throw new Problem(403,"Insufficient stock transfer authority");
      if(op.moveBatch&&!session.capabilities.includes(op.moveBatch.parentWriteCapability))
        throw new Problem(403,"Insufficient batch settlement authority");
      if(op.createDetails&&!session.capabilities.includes(op.createDetails.childWriteCapability))
        throw new Problem(403,"Insufficient detail-write authority");
      if(op.reverseBatch&&!session.capabilities.includes(op.reverseBatch.parentWriteCapability))
        throw new Problem(403,"Insufficient batch reversal authority");
      if(op.reverseUnits&&!session.capabilities.includes(op.reverseUnits.parentWriteCapability))
        throw new Problem(403,"Insufficient stock reversal authority");
      if(op.exactReconciliation&&!session.capabilities.includes(op.exactReconciliation.childReadCapability))
        throw new Problem(403,"Insufficient ledger read capability");
      if(op.detailSum&&!session.capabilities.includes(op.detailSum.childReadCapability))
        throw new Problem(403,"Insufficient child read authority");
      if(op.relatedSum&&!session.capabilities.includes(op.relatedSum.childReadCapability))
        throw new Problem(403,"Insufficient related entity read capability");
      if(op.release&&!session.capabilities.includes(op.release.stockWriteCapability))
        throw new Problem(403,"Insufficient stock write capability");
      const entity=this.entities.get(op.entity);
      if(!entity)throw new Error("Unknown generated entity");
      const identity=req.params?.[entity.publicIdentity];
      let data:unknown;
      switch(op.kind){
        case "create": data=await this.create(entity,op,req.body,session.username,session.capabilities,req.headers["if-match"]);break;
        case "get":data=await this.row(entity,identity,session.username);break;
        case "sumRelated":data=await this.sumRelated(op,identity);break;
        case "sumDetails":data=await this.sumDetails(op,identity);break;
        case "reconcileExact":data=await this.reconcileExact(op,identity);break;
        case "listPage":data=await this.page(entity,op,req.query??{},session.username);break;
        case "queryPage":data=await this.queryPage(entity,op,req.query??{});break;
        case "inboxPage":case "ackNotification":data=await this.inbox(entity,op,req,session.username);break;
        case "auditPage":data=await this.auditPage(entity,identity,op,req.query??{});break;
        case "patchFields":data=await this.patch(entity,op,identity,req.body,session.username,req.headers["if-match"]);break;
        case "replaceDetails":data=await this.replaceDetails(entity,identity,req.body,
          session.username,session.capabilities,req.headers["if-match"]);break;
        case "patchTogether":data=await this.patchTogether(entity,op,identity,req.body,session.username);break;
        case "atomicIncrement":data=await this.increment(entity,op,identity,req.body);break;
        case "transition":data=await this.transition(entity,op,identity,req.body,session.username,
          req.headers["if-match"]);break;
        case "reassignReference":data=await this.reassignReference(entity,op,identity,req.body,session.username);break;
        case "delete":await this.remove(entity,op,identity,session.username,session.capabilities,
          req.headers["if-match"],req.body);res.status(204).send();return;
        default:throw new Error("Unsupported generated operation");
      }
      const redacted=(record:unknown):unknown=>{
        if(!isRecord(record))return record;
        const copy={...record};
        for(const f of entity.fields)if(f.readCapability&&!session.capabilities.includes(f.readCapability))
          delete copy[f.name];
        return copy;
      };
      if(["create","get","patchFields","patchTogether"].includes(op.kind))data=redacted(data);
      else if(op.kind==="listPage"&&isRecord(data)&&Array.isArray(data.items))
        data={...data,items:data.items.map(redacted)};
      if(["get","create"].includes(op.kind)&&isRecord(data)&&
        Number.isInteger(data.documentVersion))
        res.setHeader("ETag",'"'+String(data.documentVersion)+'"');
      res.status(op.kind==="create"?201:200).json(data);
    }catch(error){
      if(op.kind==="delete"&&(error as {code?:string})?.code==="23503"){
        sendProblem(res,new Problem(409,"Referenced resource cannot be deleted"));
      }else sendProblem(res,error);
    }
  }
}
@Controller()
class MetadataController{
  constructor(@Inject(RuntimeService)private readonly service:RuntimeService){}
  @Get("health")health(){return {status:"UP"};}
  @Get("api/_protocolia/auth/config")authConfig(){return this.service.authConfig();}
  @Get("api/_protocolia/me")async me(@Req() req:any,@Res() res:any):Promise<void>{await this.service.me(req,res);}
}
function operationController(op:Operation):any{
  @Controller()
  class GeneratedOperationController{
    constructor(@Inject(RuntimeService)private readonly service:RuntimeService){}
    @RequestMapping({path:op.path.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,":$1"),
      method:(RequestMethod as any)[op.method]})
    async execute(@Req() req:any,@Res() res:any):Promise<void>{
      await this.service.dispatch(op,req,res);
    }
  }
  return GeneratedOperationController;
}
@Module({
  controllers:[MetadataController,...spec.operations.filter(o=>o.kind!=="health").map(operationController)],
  providers:[RuntimeService]
})
class ContractModule{}
async function bootstrap(){
  const execution=process.env.PROTOCOLIA_EXECUTION_MODE??"legacy";
  if(!["legacy","migrate","runtime"].includes(execution))
    throw Error("Unsupported ProtocolIA execution mode");
  if(execution==="migrate"){
    if(!["","before-commit","after-commit","pause-after-commit"].includes(process.env.PROTOCOLIA_MIGRATION_FAILPOINT??""))
      throw Error("Invalid migration failpoint");
    const runner=new RuntimeService();
    try{
      await runner.init();
      console.log("PROTOCOLIA_NEST_ONE_SHOT_MIGRATION_PASS");
    }finally{await runner.closePools();}
    return;
  }
  const app=await NestFactory.create<NestExpressApplication>(ContractModule,{logger:["error","warn"]});
  installBffSecurityHeaders(app);
  app.useStaticAssets(join(process.cwd(),"dist/static"));
  const engine=app.get(RuntimeService);
  if(execution==="runtime")await engine.verifyRuntimeReady();
  else await engine.init();
  await installBff(app,engine.bffPool(),engine);
  await app.listen(Number(process.env.PORT??8080),"0.0.0.0");
  if(spec.hasOverdueRules && process.env.PROTOCOLIA_ALERT_WORKER_ENABLED==="true"){
    const delay=Number(process.env.PROTOCOLIA_ALERT_INTERVAL_MS??"60000");
    if(!Number.isSafeInteger(delay)||delay<1000||delay>3600000)
      throw Error("Invalid PROTOCOLIA_ALERT_INTERVAL_MS (1000..3600000)");
    // Every application replica may attempt a scan, but PostgreSQL unique
    // keys and SKIP LOCKED keep internal delivery idempotent.
    const tick=()=>{void engine.tickOverdueInbox().catch(error=>
      console.error("PROTOCOLIA_ALERT_TICK_FAILED",error));};
    tick();
    setInterval(tick,delay).unref();
  }
  console.log("PROTOCOLIA_NEST_STARTED "+JSON.stringify({
    operations:spec.operations.length,entities:spec.entities.map(e=>e.name)
  }));
}
bootstrap().catch(error=>{console.error("PROTOCOLIA_NEST_BOOT_FAILED",error);process.exitCode=1;});
