import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>readFileSync(join(root,p),"utf8");
const nest=read("packages/adapters/nest/templates/main.ts");
const spring=read("packages/adapters/modular/templates/TenantSqlRouting.java");
const springDomain=read("packages/adapters/modular/templates/DomainRuntime.java");
const springApp=read("packages/adapters/modular/templates/ContractApplication.java");
const nestGen=read("packages/adapters/nest/generate.mjs");
const springGen=read("packages/adapters/modular/generate.mjs");
const sql=read("packages/adapters/tenant-rls-role-candidate.mjs");
test("NestJS routes every business SQL call by authenticated async context, with no fallback",()=>{
 assert.match(nest,/AsyncLocalStorage<Pool>/);
 assert.match(nest,/private sqlPool\(\):Pool/);
 assert.match(nest,/this\.tenantSqlContext\.getStore\(\)/);
 assert.match(nest,/Tenant SQL query without authenticated routing context/);
 assert.match(nest,/withTenantSql<T>/);
 assert.match(nest,/await this\.withTenantSql\(session\.tenant,async\(\)=>\{/);
 assert.match(nest,/this\.tenantSqlContext\.run\(pool,run\)/);
 assert.match(nest,/this\.tenantSqlBeta=new Pool/);
 assert.match(nest,/this\.tenantSqlEnabled=routing==="alpha-beta-v1"/);
 const start=nest.indexOf("  private async inbox(");
 const end=nest.indexOf("  async dispatch(op:Operation,req:any,res:any)");
 assert.ok(start>0&&end>start);
 const business=nest.slice(start,end);
 assert.ok((business.match(/this\.sqlPool\(\)\.query\(/g)||[]).length>=15);
 assert.ok((business.match(/this\.sqlPool\(\)\.connect\(/g)||[]).length>=10);
 assert.doesNotMatch(business,/this\.pool\.(?:query|connect)\(/,
  "A direct business SQL call bypasses request tenant routing");
 assert.match(nest,/verifyTenantSqlReady\(\)/);
 assert.match(nest,/row\.entity_rls!==true\|\|row\.audit_rls!==true/);
 assert.match(nestGen,/PROTOCOLIA_TENANT_SQL_ROUTING/);
});
test("Spring SQL routing uses verified principal before transaction connection acquisition",()=>{
 for(const value of ["AbstractRoutingDataSource","setLenientFallback(false)",
   "SecurityContextHolder.getContext().getAuthentication()",
   "DomainRuntime.verifiedTenant(auth)","@ConditionalOnProperty",
   "PROTOCOLIA_EXECUTION_MODE","PROTOCOLIA_TENANT_SQL_ALPHA_USER",
   "PROTOCOLIA_TENANT_SQL_BETA_USER","session_user,current_user",
   "public.protocolia_rls_session_tenant()",
   "relforcerowsecurity","audit_rls","member","can_create"]){
  assert.ok(spring.includes(value),"Missing Spring SQL role safeguard: "+value);
 }
 assert.ok(spring.includes("Manifest.OPS.size()!=6"),
  "Spring generated manifest omits the separately handled public health op");
 assert.match(springDomain,/static String verifiedTenant\(Authentication user\)/);
 assert.match(springApp,/Tenant SQL routing requires isolated HTTP runtime mode/);
 assert.match(springGen,/TenantSqlRouting\.java/);
 assert.match(read("packages/adapters/modular/templates/compose.yaml"),/PROTOCOLIA_TENANT_SQL_BETA_PASSWORD/);
 assert.match(nestGen,/PROTOCOLIA_TENANT_SQL_BETA_PASSWORD/);
});
test("RLS role candidate protects audit source and forces a safe migration boundary",()=>{
 for(const value of [
  "public.protocolia_audit_event","Audit table must be empty",
  "unreviewed grants","DEFAULT public.protocolia_rls_session_tenant()",
  "CREATE POLICY protocolia_rls_audit_insert","GRANT INSERT ON public.protocolia_audit_event",
  "GRANT USAGE ON SEQUENCE public.protocolia_audit_event_id_seq",
  "ALTER TABLE public.protocolia_audit_event FORCE ROW LEVEL SECURITY",
  "has_table_privilege(role_name,'public.protocolia_audit_event','SELECT')"
 ])assert.ok(sql.includes(value),"Audit RLS guarantee absent: "+value);
 assert.doesNotMatch(sql,/GRANT SELECT ON public\.protocolia_audit_event/);
 assert.match(read("scripts/research/tenant-rls-role-e2e.sh"),/Audit containment or tenant defaults failed/);
});
