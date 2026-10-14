import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync,readdirSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const uiRoot=resolve(root,"../modular/templates/web");
const safe=x=>{if(typeof x!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(x))throw Error("Unsafe identifier "+x);return x;};
const snake=x=>safe(x).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
const deref=(s,p)=>p?.$ref?p.$ref.split("/").slice(1).reduce((o,k)=>o?.[k],s):p;
function numberSchema(spec,op,query){
  const endpoint=spec.paths?.[op.path]?.[op.method.toLowerCase()];
  let field;
  if(query){
    const param=endpoint?.parameters?.map(p=>deref(spec,p)).find(p=>p.name===query&&p.in==="query");
    field=deref(spec,param?.schema);
  }else{
    const body=deref(spec,endpoint?.requestBody);
    const model=deref(spec,body?.content?.["application/json"]?.schema);
    field=deref(spec,model?.properties?.[op.behavior.input]);
  }
  if(!field||!Number.isInteger(field.minimum)||!Number.isInteger(field.maximum)||
     (query&&!Number.isInteger(field.default)))throw Error("Unresolved bounds "+op.name+" "+query);
  return field;
}
export function generate(ir,spec,out){
  if(ir?.irVersion!=="vnext-a0.1"||!Array.isArray(ir.entities)||
    ir.entities.length<1||ir.entities.length>8||!Array.isArray(ir.operations))
    throw Error("Unsupported canonical contract IR for NestJS");
  if(existsSync(out)&&readdirSync(out).length)throw Error("Output not empty; refusing overwrite");
  const entities=new Map(),tables=new Set(),reads=[],writes=[],compiled=[];
  for(const e of ir.entities){
    safe(e.name);safe(e.publicIdentity);
    if(entities.has(e.name)||tables.has(snake(e.name)))throw Error("Duplicate entity/table");
    entities.set(e.name,e);tables.add(snake(e.name));
    if(!e.fields.some(f=>f.name===e.publicIdentity&&f.type==="string"&&f.unique&&f.required&&!f.nullable))
      throw Error("Public identity must be required unique string");
    const columns=new Set();
    for(const f of e.fields){
      safe(f.name);
      if(columns.has(snake(f.name)))throw Error("Duplicate SQL column");
      columns.add(snake(f.name));
      if(!["string","int32","utcDateTime"].includes(f.type))throw Error("Unsupported field type");
      if(f.initial!==undefined && (f.type!=="string"||!f.required||f.nullable||f.unique||
        f.reference||typeof f.initial!=="string"||!/^[a-z][a-z0-9_-]{0,63}$/.test(f.initial)||
        f.initial.length<(f.minLength??1)||f.initial.length>(f.maxLength??255)))
        throw Error("Invalid finite-state initial value "+e.name+"."+f.name);
      if(f.type==="string"&&(!Number.isInteger(f.maxLength??255)||(f.maxLength??255)<1))
        throw Error("Invalid string maximum length");
    }
  }
  for(const e of ir.entities)for(const f of e.fields)if(f.reference){
    const target=entities.get(f.reference.target);
    const targetField=target?.fields.find(x=>x.name===target.publicIdentity);
    if(!target||target===e||!targetField||targetField.type!=="string"||f.type!=="string"||
      f.reference.onDelete!=="restrict"||!f.required||f.nullable||
      (f.maxLength??255)<(targetField.maxLength??255))
      throw Error("Unsupported FK: "+e.name+"."+f.name);
  }
  const methods={create:"POST",get:"GET",listPage:"GET",patchFields:"PATCH",
    atomicIncrement:"PATCH",transition:"POST",delete:"DELETE",health:"GET"};
  const ok={create:201,get:200,listPage:200,patchFields:200,
    atomicIncrement:200,transition:200,delete:204,health:200};
  const routeKeys=new Set(),of=(kind,entity)=>ir.operations.filter(o=>
    o.behavior?.kind===kind&&(!entity||o.entity===entity));
  if(of("health").length!==1)throw Error("One health operation required");
  for(const e of ir.entities){
    for(const kind of ["create","get","listPage"])
      if(of(kind,e.name).length!==1)throw Error("Missing "+kind+" on "+e.name);
    for(const kind of ["patchFields","atomicIncrement","delete"])
      if(of(kind,e.name).length>1)throw Error("Duplicate "+kind+" on "+e.name);
    const read=of("get",e.name)[0].capability,write=of("create",e.name)[0].capability;
    if(!read||!write||read===write||read==="public"||write==="public")
      throw Error("Invalid read/write capabilities");
    if(!reads.includes(read))reads.push(read);
    if(!writes.includes(write))writes.push(write);
    for(const op of ir.operations.filter(o=>o.entity===e.name)){
      const b=op.behavior,kind=b?.kind;
      if(!methods[kind]||op.method!==methods[kind]||!op.statuses?.includes(ok[kind]))
        throw Error("Verb/status mismatch "+op.name);
      const cap=kind==="health"?"public":
        ["create","patchFields","atomicIncrement","transition","delete"].includes(kind)?write:read;
      if(op.capability!==cap)throw Error("Wrong capability "+op.name);
      if(!/^\/[A-Za-z0-9_/{}/-]+$/.test(op.path)||routeKeys.has(op.method+" "+op.path))
        throw Error("Duplicate/invalid route "+op.name);
      routeKeys.add(op.method+" "+op.path);
      const tokens=[...op.path.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(x=>x[1]);
      const keyed=["get","patchFields","atomicIncrement","transition","delete"].includes(kind);
      if(keyed?(tokens.length!==1||tokens[0]!==e.publicIdentity):tokens.length>0)
        throw Error("Public identity mismatch "+op.name);
      if(b.audit){
        const fields=b.audit;
        if(!Array.isArray(fields)||fields.length===0||fields.length>8||
           new Set(fields).size!==fields.length||!["create","transition"].includes(kind)||
           fields.some(x=>!e.fields.some(f=>f.name===x))||
           (kind==="transition"&&(fields.length!==1||fields[0]!==b.field))||
           (kind==="create"&&fields.includes(e.publicIdentity)))
          throw Error("Invalid audited operation "+op.name);
      }
      if(b.reserve){
        const stock=entities.get(b.reserve.stockEntity);
        const available=stock?.fields.find(f=>f.name===b.reserve.availableField);
        const relation=e.fields.find(f=>f.name===b.reserve.referenceField);
        const amount=e.fields.find(f=>f.name===b.reserve.quantityField);
        if(kind!=="create"||!stock||stock===e||!available||
           available.type!=="int32"||!available.required||available.nullable||
           (available.min??-1)<0||!relation||relation.type!=="string"||
           !relation.required||relation.nullable||relation.reference?.target!==stock.name||
           !amount||amount.type!=="int32"||!amount.required||amount.nullable||
           (amount.min??-1)<1||!op.statuses?.includes(400)||!op.statuses?.includes(409))
          throw Error("Invalid atomic reserve "+op.name);
      }
      if(b.release){
        const r=b.release,stock=entities.get(r.stockEntity);
        const available=stock?.fields.find(f=>f.name===r.availableField);
        const relation=e.fields.find(f=>f.name===r.referenceField);
        const amount=e.fields.find(f=>f.name===r.quantityField);
        const state=e.fields.find(f=>f.name===b.field);
        const matching=of("create",e.name).filter(x=>x.behavior.reserve &&
          Object.keys(r).every(k=>x.behavior.reserve[k]===r[k]));
        if(kind!=="transition"||!state?.initial||b.from!==state.initial||
           !stock||stock===e||!available||available.type!=="int32"||!available.required||
           available.nullable||(available.min??-1)<0||!relation||relation.type!=="string"||
           !relation.required||relation.nullable||relation.reference?.target!==stock.name||
           !amount||amount.type!=="int32"||!amount.required||amount.nullable||
           (amount.min??-1)<1||matching.length!==1||
           ir.operations.some(x=>x.entity===e.name&&x.behavior.kind==="transition"&&
             x.behavior.field===state.name&&x.behavior.from===b.to))
          throw Error("Invalid exactly-once release "+op.name);
      }
      if(kind==="transition"){
        const field=e.fields.find(f=>f.name===b.field);
        const safe=x=>typeof x==="string" && /^[a-z][a-z0-9_-]{0,63}$/.test(x) &&
          x.length>=(field?.minLength??1) && x.length<=(field?.maxLength??255);
        if(!field||!field.initial||field.type!=="string"||!field.required||field.nullable||
          !safe(b.from)||!safe(b.to)||b.from===b.to||b.input||!op.statuses?.includes(409))
          throw Error("Invalid source-guarded transition "+op.name);
      }
      if(["patchFields","atomicIncrement"].includes(kind)){
        const field=e.fields.find(f=>f.name===b.field);
        if(!field||!b.input||
           (kind==="patchFields"&&(field.type!=="string"||field.nullable||field.initial!==undefined||b.input!==b.field))||
           (kind==="atomicIncrement"&&field.type!=="int32"))
          throw Error("Unsupported mutation "+op.name);
      }
      const item={name:op.name,method:op.method,path:op.path,entity:e.name,
        kind,capability:op.capability,...(b.audit?{audit:b.audit}:{}),...(b.field?{field:b.field}:{}),
        ...(b.input?{input:b.input}:{}),...(kind==="transition"?{from:b.from,to:b.to}:{})};
      if(b.reserve){
        const stock=entities.get(b.reserve.stockEntity);
        const stockCreate=of("create",stock.name)[0];
        if(!stockCreate||stockCreate.capability==="public")throw Error("Missing stock writer capability");
        item.reserve={
          stockTable:snake(stock.name),stockKeyColumn:snake(stock.publicIdentity),
          availableColumn:snake(b.reserve.availableField),referenceField:b.reserve.referenceField,
          quantityField:b.reserve.quantityField,stockWriteCapability:stockCreate.capability
        };
      }
      if(b.release){
        const stock=entities.get(b.release.stockEntity);
        const write=of("create",stock.name)[0];
        if(!write||write.capability==="public")throw Error("Missing stock writer capability");
        item.release={
          stockTable:snake(stock.name),stockKeyColumn:snake(stock.publicIdentity),
          availableColumn:snake(b.release.availableField),
          referenceColumn:snake(b.release.referenceField),amountColumn:snake(b.release.quantityField),
          stockWriteCapability:write.capability
        };
      }
      if(kind==="listPage"){
        const l=numberSchema(spec,op,"limit"),o=numberSchema(spec,op,"offset");
        Object.assign(item,{limitMin:l.minimum,limitMax:l.maximum,limitDefault:l.default,
          offsetDefault:o.default,offsetMax:o.maximum});
      }
      if(kind==="atomicIncrement"){
        const n=numberSchema(spec,op);
        Object.assign(item,{inputMin:n.minimum,inputMax:n.maximum});
      }
      compiled.push(item);
    }
  }
  if(reads.some(x=>writes.includes(x)))throw Error("Ambiguous read/write authority");
  const contents=[];
  const write=(p,t)=>{
    const full=join(out,p);mkdirSync(dirname(full),{recursive:true});
    writeFileSync(full,t);contents.push(p);
  };
  const copy=(p,source)=>{
    const full=join(out,p);mkdirSync(dirname(full),{recursive:true});
    copyFileSync(source,full);contents.push(p);
  };
  const schema=[];
  for(const e of ir.entities){
    const fields=e.fields.map(f=>{
      const col=snake(f.name),sqlType=f.type==="string"?"VARCHAR("+(f.maxLength??255)+")":
        f.type==="int32"?"INTEGER":"TIMESTAMP WITH TIME ZONE";
      const checks=[f.name===e.publicIdentity?"PRIMARY KEY":"",
        f.required&&!f.nullable?"NOT NULL":"",
        f.unique&&f.name!==e.publicIdentity?"UNIQUE":"",
        f.type==="string"&&f.minLength!==undefined?"CHECK (char_length("+col+") >= "+f.minLength+")":"",
        f.type==="string"&&f.required&&!f.nullable?"CHECK (char_length(btrim("+col+")) > 0)":"",
        f.min!==undefined?"CHECK ("+col+">="+f.min+")":"",
        f.max!==undefined?"CHECK ("+col+"<="+f.max+")":""].filter(Boolean);
      if(f.initial!==undefined){
        const states=new Set([f.initial,...ir.operations.filter(op=>
          op.entity===e.name&&op.behavior.kind==="transition"&&op.behavior.field===f.name)
          .flatMap(op=>[op.behavior.from,op.behavior.to])]);
        if(states.size<2||[...states].some(v=>typeof v!=="string"||!/^[a-z][a-z0-9_-]{0,63}$/.test(v)))
          throw Error("Invalid finite-state transition values");
        checks.push("CHECK ("+col+" IN ("+[...states].sort().map(v=>"'"+v+"'").join(",")+"))");
      }
      return "  "+col+" "+sqlType+" "+checks.join(" ");
    });
    schema.push("CREATE TABLE "+snake(e.name)+" (\n"+fields.join(",\n")+"\n);");
  }
  for(const e of ir.entities)for(const f of e.fields)if(f.reference){
    const parent=entities.get(f.reference.target);
    schema.push("ALTER TABLE "+snake(e.name)+" ADD CONSTRAINT fk_"+snake(e.name)+"_"+
      snake(f.name)+" FOREIGN KEY ("+snake(f.name)+") REFERENCES "+
      snake(parent.name)+" ("+snake(parent.publicIdentity)+") ON DELETE RESTRICT;");
  }
  if(ir.operations.some(op=>op.behavior.audit))schema.push(
    "CREATE TABLE protocolia_audit_event (id BIGSERIAL PRIMARY KEY, "+
    "actor VARCHAR(255) NOT NULL, entity_name VARCHAR(128) NOT NULL, "+
    "resource_id VARCHAR(255) NOT NULL, operation_name VARCHAR(128) NOT NULL, "+
    "field_name VARCHAR(128) NOT NULL, before_value TEXT, after_value TEXT, "+
    "occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);",
    "CREATE INDEX idx_protocolia_audit_resource ON protocolia_audit_event (entity_name,resource_id,id);");
  const manifest={entities:ir.entities.map(e=>({name:e.name,table:snake(e.name),
    publicIdentity:e.publicIdentity,identityColumn:snake(e.publicIdentity),
    fields:e.fields.map(f=>({...f,column:snake(f.name)}))})),
    operations:compiled,readCapabilities:reads,writeCapabilities:writes};
  write("src/manifest.json",JSON.stringify(manifest,null,2)+"\n");
  write("src/schema.sql",schema.join("\n")+"\n");
  mkdirSync(join(out,"src/migrations"),{recursive:true});
  copy("src/main.ts",join(root,"templates/main.ts"));
  write("package.json",JSON.stringify({name:"protocolia-nest-generated",
    private:true,version:"0.0.1",
    scripts:{build:"tsc -p tsconfig.json",start:"node dist/main.js"},
    dependencies:{"@nestjs/common":"11.1.6","@nestjs/core":"11.1.6",
      "@nestjs/platform-express":"11.1.6","pg":"8.16.3",
      "reflect-metadata":"0.2.2","rxjs":"7.8.2"},
    devDependencies:{"typescript":"5.9.3","@types/node":"24.3.0","@types/pg":"8.15.5"}
  },null,2)+"\n");
  write("tsconfig.json",JSON.stringify({compilerOptions:{target:"ES2022",
    module:"CommonJS",moduleResolution:"Node",outDir:"dist",rootDir:"src",
    strict:false,esModuleInterop:true,experimentalDecorators:true,
    emitDecoratorMetadata:true,resolveJsonModule:true,skipLibCheck:true},
    include:["src/**/*.ts"]},null,2)+"\n");
  for(const f of ["package.json","index.html","src/main.jsx","src/App.jsx","src/style.css"])
    copy("web/"+f,join(uiRoot,f));
  write("web/vite.config.mjs",'import {defineConfig} from "vite";\n'+
    'export default defineConfig({base:"/",build:{outDir:"../dist/static",emptyOutDir:false}});\n');
  const resources=ir.entities.map(entity=>({entity,view:entity.view??entity.name,
    transitions:ir.operations.filter(op=>op.entity===entity.name&&op.behavior.kind==="transition")
      .map(op=>({name:op.name,method:op.method,path:op.path,capability:op.capability,behavior:op.behavior})),
    operations:Object.fromEntries(ir.operations.filter(op=>
      op.entity===entity.name&&op.behavior.kind!=="health"&&op.behavior.kind!=="transition").map(op=>[
        op.behavior.kind,{method:op.method,path:op.path,capability:op.capability,behavior:op.behavior}
      ]))}));
  write("dist/static/protocolia-ui.json",JSON.stringify({...resources[0],resources},null,2)+"\n");
  write("Dockerfile",[
    "FROM node:24-bookworm-slim","WORKDIR /app",
    "COPY package*.json ./","RUN npm ci --omit=dev",
    "COPY dist ./dist","COPY src/schema.sql ./src/schema.sql",
    "COPY src/migrations ./src/migrations",
    "EXPOSE 8080",'CMD ["node","dist/main.js"]',""
  ].join("\n"));
  write(".dockerignore","node_modules/\nweb/\n.protocolia-toolchain/\n.env\n");
  write(".env.example",[
    "PROTOCOLIA_DB_PASSWORD=","PROTOCOLIA_ALLOW_DEMO_AUTH=false",
    "PROTOCOLIA_READER_USERNAME=reader","PROTOCOLIA_READER_PASSWORD=",
    "PROTOCOLIA_MANAGER_USERNAME=manager","PROTOCOLIA_MANAGER_PASSWORD=",""
  ].join("\n"));
  write("compose.yaml",[
    "services:","  db:","    image: postgres:16.15-alpine",
    "    environment:","      POSTGRES_DB: protocolia",
    "      POSTGRES_USER: protocolia",
    '      POSTGRES_PASSWORD: ${PROTOCOLIA_DB_PASSWORD:?set PROTOCOLIA_DB_PASSWORD}',
    '    volumes: ["protocolia_nest_data:/var/lib/postgresql/data"]',
    "    healthcheck:",
    '      test: ["CMD-SHELL", "pg_isready -U protocolia -d protocolia"]',
    "      interval: 5s","      retries: 15",
    "  app:","    build: .","    ports:",
    '      - "127.0.0.1:${PROTOCOLIA_HOST_PORT:-8080}:8080"',
    "    depends_on:","      db:","        condition: service_healthy",
    "    environment:",'      PORT: "8080"',
    "      PROTOCOLIA_JDBC_URL: postgresql://db:5432/protocolia",
    "      PROTOCOLIA_JDBC_USER: protocolia",
    '      PROTOCOLIA_JDBC_PASSWORD: ${PROTOCOLIA_DB_PASSWORD:?set PROTOCOLIA_DB_PASSWORD}',
    '      PROTOCOLIA_ALLOW_DEMO_AUTH: ${PROTOCOLIA_ALLOW_DEMO_AUTH:-false}',
    '      PROTOCOLIA_READER_USERNAME: ${PROTOCOLIA_READER_USERNAME:-reader}',
    '      PROTOCOLIA_READER_PASSWORD: ${PROTOCOLIA_READER_PASSWORD:?set PROTOCOLIA_READER_PASSWORD}',
    '      PROTOCOLIA_MANAGER_USERNAME: ${PROTOCOLIA_MANAGER_USERNAME:-manager}',
    '      PROTOCOLIA_MANAGER_PASSWORD: ${PROTOCOLIA_MANAGER_PASSWORD:?set PROTOCOLIA_MANAGER_PASSWORD}',
    "volumes:","  protocolia_nest_data:",""
  ].join("\n"));
  const result={adapter:"nestjs",irVersion:ir.irVersion,
    sourceSha256:createHash("sha256").update(JSON.stringify(ir)).digest("hex"),
    files:contents.sort(),outcomes:"Generated; tests required"};
  write("protocolia-generation.json",JSON.stringify(result,null,2)+"\n");
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,openapi,out]=process.argv.slice(2);
  if(!input||!openapi||!out)throw Error("Usage: generate.mjs ir.json openapi.json out");
  const r=generate(JSON.parse(readFileSync(input,"utf8")),
    JSON.parse(readFileSync(openapi,"utf8")),resolve(out));
  console.log("PROTOCOLIA_NEST_PROJECT_GENERATED "+JSON.stringify({files:r.files.length,sourceSha256:r.sourceSha256}));
}
