#!/usr/bin/env node
// Emit an operator-only RLS role-binding candidate from the compiled TypeSpec IR.
// Does not execute SQL, create application roles or modify production databases.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {tenantRlsRoleCandidateSql} from "../../packages/adapters/tenant-rls-role-candidate.mjs";
const [irFile,outFile]=process.argv.slice(2);
if(!irFile||!outFile)throw Error("Usage: tenant-rls-role-candidate.mjs CANONICAL_IR_JSON OUT_SQL");
const ir=JSON.parse(readFileSync(resolve(irFile),"utf8"));
const sql=tenantRlsRoleCandidateSql(ir);
if(!sql)throw Error("RLS_CANDIDATE_UNSUPPORTED: requires opt-in bounded tenant+maker-checker profile");
writeFileSync(resolve(outFile),sql,{flag:"wx",mode:0o600});
console.log("PROTOCOLIA_TENANT_RLS_ROLE_CANDIDATE_EMITTED");
