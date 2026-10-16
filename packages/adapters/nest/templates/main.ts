import {Controller,Get,Inject,Injectable,Module,NestModule,RequestMapping,RequestMethod,Req,Res} from "@nestjs/common";
import {NestFactory} from "@nestjs/core";
import {NestExpressApplication} from "@nestjs/platform-express";
import {createHash,timingSafeEqual} from "node:crypto";
import {existsSync,readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {Pool} from "pg";
import "reflect-metadata";
import contract from "./manifest.json";

type Field={name:string;column:string;type:string;required:boolean;nullable:boolean;unique:boolean;computedSum?:string[];computedProduct?:[string,string];computedRoundedProduct?:{left:string;right:string;mode:"half_up"};computedDiscountedTotal?:{price:string;quantity:string;discount:string;mode:"half_up"};min?:number;max?:number;minLength?:number;maxLength?:number;pattern?:string;choices?:Array<{value:string;label:string}>;reference?:{target:string;onDelete:string};initial?:string;requiredWhen?:{field:string;equals:string};decimal?:{precision:number;scale:number;min?:string;max?:string};afterField?:string;greaterThanField?:string};
type Entity={name:string;table:string;publicIdentity:string;identityColumn:string;fields:Field[]};
type Reserve={stockTable:string;stockKeyColumn:string;availableColumn:string;referenceField:string;quantityField:string;stockWriteCapability:string};
type Release={stockTable:string;stockKeyColumn:string;availableColumn:string;referenceColumn:string;amountColumn:string;stockWriteCapability:string};
type QueryFilter={name:string;expression:string;comparator:string;type:string;minLength:number|null;maxLength:number|null;min:number|null;max:number|null;pattern:string|null};
type QuerySpec={projection:string;source:string;order:string;filters:QueryFilter[]};
type Operation={query?:QuerySpec;name:string;method:string;path:string;entity:string;kind:string;capability:string;audit?:string[];reserve?:Reserve;release?:Release;field?:string;input?:string;from?:string;to?:string;inputMin?:number;inputMax?:number;limitDefault?:number;limitMin?:number;limitMax?:number;offsetDefault?:number;offsetMax?:number};
type Manifest={entities:Entity[];operations:Operation[];readCapabilities:string[];writeCapabilities:string[];auditCapabilities:string[];assignmentCapabilities:string[];hasOverdueRules?:boolean};
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
  private readonly entities=new Map<string,Entity>(spec.entities.map(e=>[e.name,e]));
  constructor(){
    const source=(process.env.PROTOCOLIA_JDBC_URL??"").replace(/^jdbc:/,"");
    if(!/^postgres(?:ql)?:\/\//.test(source))throw Error("PostgreSQL connection required");
    const connection=new URL(source);
    if(!connection.username)connection.username=process.env.PROTOCOLIA_JDBC_USER??"";
    if(!connection.password)connection.password=process.env.PROTOCOLIA_JDBC_PASSWORD??"";
    if(!connection.username)throw Error("PostgreSQL username must be explicit");
    this.pool=new Pool({connectionString:connection.toString(),max:20});
    if(process.env.PROTOCOLIA_ALLOW_DEMO_AUTH==="true")
      for(const key of ["PROTOCOLIA_READER_USERNAME","PROTOCOLIA_READER_PASSWORD",
        "PROTOCOLIA_MANAGER_USERNAME","PROTOCOLIA_MANAGER_PASSWORD"])
        if(!process.env[key])throw Error("Missing demo credential: "+key);
    if(process.env.PROTOCOLIA_ALLOW_DEMO_AUTH==="true"&&process.env.PROTOCOLIA_READER_USERNAME?.toLowerCase()===process.env.PROTOCOLIA_MANAGER_USERNAME?.toLowerCase())
      throw Error("Demo subjects must be distinct");
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
  async init():Promise<void>{
    const connection=await this.pool.connect();
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
      await connection.query("COMMIT");
    }catch(e){await connection.query("ROLLBACK");throw e;}
    finally{connection.release();}
  }
  login(req:any):{username:string;capabilities:string[]}{
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
    if(!manager&&!reader)throw new Problem(401,"Invalid credentials");
    return {username,capabilities:manager?[...new Set([...spec.readCapabilities,...spec.writeCapabilities,...(spec.auditCapabilities??[]),...(spec.assignmentCapabilities??[])])].sort():
      [...spec.readCapabilities].sort()};
  }
  me(req:any,res:any):void{
    try{res.status(200).json(this.login(req));}catch(e){sendProblem(res,e);}
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
    return "SELECT "+e.fields.map(f=>f.column+' AS "'+f.name+'"').join(",")+" FROM "+e.table;
  }
  private async row(e:Entity,id:string):Promise<Record<string,unknown>>{
    const response=await this.pool.query(this.select(e)+" WHERE "+e.identityColumn+"=$1",[id]);
    if(!response.rows.length)throw new Problem(404,"Not found");
    return response.rows[0];
  }
  private async page(e:Entity,op:Operation,query:Record<string,unknown>):Promise<unknown>{
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
    const [items,count]=await Promise.all([
      this.pool.query(this.select(e)+" ORDER BY "+e.identityColumn+" LIMIT $1 OFFSET $2",[limit,offset]),
      this.pool.query("SELECT COUNT(*)::integer AS total FROM "+e.table)
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
  private async create(e:Entity,op:Operation,body:unknown,actor:string):Promise<Record<string,unknown>>{
    const input={...validateInput(e,body,e.fields.filter(f=>!f.computedSum&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal).map(f=>f.name),true)};
    for(const f of e.fields)if(f.initial!==undefined && !Object.hasOwn(input,f.name))
      input[f.name]=f.initial;
    const persisted=e.fields.filter(f=>!f.computedSum&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal);
    const cols=persisted.map(f=>f.column);
    const params=persisted.map(f=>f.type==="utcDateTime"&&input[f.name]!=null?
      parseTimestamp(input[f.name]):input[f.name]??null);
    const insert="INSERT INTO "+e.table+" ("+cols.join(",")+") VALUES ("+
      cols.map((_,i)=>"$"+(i+1)).join(",")+")";
    if(op.reserve||op.audit?.length){
      const reservation=op.reserve;
      const stock=reservation?input[reservation.referenceField]:undefined;
      const amount=reservation?input[reservation.quantityField]:undefined;
      if(reservation&&(typeof stock!=="string"||!Number.isInteger(amount)||(amount as number)<1))
        throw new Problem(400,"Invalid reservation input");
      // Audit and domain effects always commit or roll back on the same pinned connection.
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
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
        await client.query(insert,params);
        if(op.audit?.length)await this.recordAudit(client,e,op,String(input[e.publicIdentity]),actor,null,input);
        await client.query("COMMIT");
      }catch(error){
        await client.query("ROLLBACK");
        throw error;
      }finally{client.release();}
    }else await this.pool.query(insert,params);
    return this.row(e,String(input[e.publicIdentity]));
  }
  private async patch(e:Entity,op:Operation,key:string,body:unknown):Promise<Record<string,unknown>>{
    const input=validateInput(e,body,[op.input!],false);
    if(Object.keys(input).length!==1||!Object.hasOwn(input,op.input!))
      throw new Problem(400,"Expected one patch property");
    const field=e.fields.find(f=>f.name===op.field)!;
    const changed=await this.pool.query("UPDATE "+e.table+" SET "+field.column+
      "=$1 WHERE "+e.identityColumn+"=$2 RETURNING "+e.identityColumn,[input[op.input!],key]);
    if(!changed.rowCount)throw new Problem(404,"Not found");
    return this.row(e,key);
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
  private async transition(e:Entity,op:Operation,key:string,body:unknown,actor:string):Promise<Record<string,unknown>>{
    if(body!==undefined&&body!==null&&(!isRecord(body)||Object.keys(body).length!==0))
      throw new Problem(400,"Transition does not accept input");
    const field=e.fields.find(f=>f.name===op.field)!;
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
  private async remove(e:Entity,key:string):Promise<void>{
    try{
      const deleted=await this.pool.query("DELETE FROM "+e.table+
        " WHERE "+e.identityColumn+"=$1 RETURNING "+e.identityColumn,[key]);
      if(!deleted.rowCount)throw new Problem(404,"Not found");
    }catch(e){
      if((e as {code?:string}).code==="23503")throw new Problem(409,"Referenced resource cannot be deleted");
      throw e;
    }
  }
  async dispatch(op:Operation,req:any,res:any):Promise<void>{
    try{
      const session=this.login(req);
      if(!session.capabilities.includes(op.capability))throw new Problem(403,"Insufficient capability");
      if(op.reserve&&!session.capabilities.includes(op.reserve.stockWriteCapability))
        throw new Problem(403,"Insufficient stock write capability");
      if(op.release&&!session.capabilities.includes(op.release.stockWriteCapability))
        throw new Problem(403,"Insufficient stock write capability");
      const entity=this.entities.get(op.entity);
      if(!entity)throw new Error("Unknown generated entity");
      const identity=req.params?.[entity.publicIdentity];
      let data:unknown;
      switch(op.kind){
        case "create": data=await this.create(entity,op,req.body,session.username);break;
        case "get":data=await this.row(entity,identity);break;
        case "listPage":data=await this.page(entity,op,req.query??{});break;
        case "queryPage":data=await this.queryPage(entity,op,req.query??{});break;
        case "inboxPage":case "ackNotification":data=await this.inbox(entity,op,req,session.username);break;
        case "auditPage":data=await this.auditPage(entity,identity,op,req.query??{});break;
        case "patchFields":data=await this.patch(entity,op,identity,req.body);break;
        case "atomicIncrement":data=await this.increment(entity,op,identity,req.body);break;
        case "transition":data=await this.transition(entity,op,identity,req.body,session.username);break;
        case "reassignReference":data=await this.reassignReference(entity,op,identity,req.body,session.username);break;
        case "delete":await this.remove(entity,identity);res.status(204).send();return;
        default:throw new Error("Unsupported generated operation");
      }
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
  @Get("api/_protocolia/me")me(@Req() req:any,@Res() res:any):void{this.service.me(req,res);}
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
  const app=await NestFactory.create<NestExpressApplication>(ContractModule,{logger:["error","warn"]});
  app.useStaticAssets(join(process.cwd(),"dist/static"));
  const engine=app.get(RuntimeService);
  await engine.init();
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
