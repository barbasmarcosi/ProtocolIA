import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>readFileSync(join(root,p),"utf8");
const nest=read("packages/adapters/nest/templates/main.ts");
const spring=read("packages/adapters/modular/templates/HumanSqlRouting.java");

test("NestJS routes signed HTTP subject and tenant to four preflight-verified login pools",()=>{
  for(const line of [
    'this.humanSqlEnabled=routing==="human-jwt-v1"',
    'process.env.PROTOCOLIA_AUTH_MODE!=="jwt"',
    'process.env.PROTOCOLIA_EXECUTION_MODE!=="runtime"',
    'process.env.PROTOCOLIA_S2_HUMAN_SQL_BINDINGS_JSON',
    'this.humanSqlPools=new Map()',
    'this.humanSqlPools.get(checked+"|"+subject)',
    'this.tenantSqlContext.run(human,run)',
    'public.protocolia_s2_session_subject() AS human',
    'row.human!==binding.subject',
    'PROTOCOLIA_NEST_S2_HUMAN_SQL_ROUTING_READY',
    'No SQL authority for authenticated human',
    'row.can_create!==false||row.can_delete!==false',
    'row.audit_read!==false||row.member!==false',
    '},session.username);'
  ])assert.ok(nest.includes(line),"Missing NestJS verified S2 routing: "+line);
  assert.match(nest,/if\(!this\.tenantSqlEnabled&&!this\.humanSqlEnabled\)return this\.pool/);
  assert.match(nest,/this\.humanSqlPools\.get\(checked\+"\|"\+subject\)/);
  assert.doesNotMatch(nest,/this\.humanSqlContext/);
});

test("Spring binds JDBC routing to SecurityContext signed JwtAuthenticationToken only",()=>{
  for(const line of [
    'havingValue="human-jwt-v1"',
    'DomainRuntime.verifiedTenant(auth)',
    'SecurityContextHolder.getContext().getAuthentication()',
    'JwtAuthenticationToken',
    'auth.getName()',
    'setLenientFallback(false)',
    'public.protocolia_s2_session_subject() AS human',
    'S2 human SQL routing refused unsafe DB identity',
    'No S2 SQL role for authenticated JWT human',
    'PROTOCOLIA_S2_HUMAN_SQL_BINDINGS_JSON',
    '"jwt".equals(System.getenv("PROTOCOLIA_AUTH_MODE"))',
    'PROTOCOLIA_MIGRATION_JDBC_PASSWORD',
    'PROTOCOLIA_SPRING_S2_HUMAN_SQL_ROUTING_READY',
    'authorizedJwtHumans=Set.copyOf(targets.keySet().stream()',
    'permitsVerifiedJwtHuman(Authentication auth)'
  ])assert.ok(spring.includes(line),"Missing Spring S2 routing guard: "+line);
  assert.match(spring,/if\(!targets\.containsKey\(key\)\)/);
  const security=read("packages/adapters/modular/templates/SecurityConfig.java");
  assert.match(security,/ObjectProvider<HumanSqlRouting> humanSql/);
  assert.match(security,/humanSql\.getObject\(\)\.permitsVerifiedJwtHuman\(auth\)/);
  assert.match(security,/BearerTokenAuthenticationFilter\.class/);
  assert.match(security,/response\.sendError\(403,"No provisioned SQL authority/);
  assert.match(spring,/targets\.put\(key,ds\)/);
  assert.match(read("packages/adapters/modular/generate.mjs"),/HumanSqlRouting\.java/);
  assert.match(read("packages/adapters/modular/templates/ContractApplication.java"),/human-jwt-v1/);
});

test("human SQL secrets are opt-in only, never silently enabled in defaults",()=>{
  const nestGen=read("packages/adapters/nest/generate.mjs");
  const springCompose=read("packages/adapters/modular/templates/compose.yaml");
  assert.match(nestGen,/PROTOCOLIA_S2_HUMAN_SQL_BINDINGS_JSON/);
  assert.match(springCompose,/PROTOCOLIA_S2_HUMAN_SQL_BINDINGS_JSON/);
  for(const t of [nestGen,springCompose]){
    assert.doesNotMatch(t,/PROTOCOLIA_TENANT_SQL_ROUTING.*human-jwt-v1\}/,
      "S2 should never activate without explicit operator opt-in");
  }
  assert.match(read("packages/adapters/subject-role-guard-candidate.mjs"),/OPERATOR-ONLY/);
});
