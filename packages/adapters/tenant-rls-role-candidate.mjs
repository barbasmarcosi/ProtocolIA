// P2 RLS-S0: role-pinned PostgreSQL defense-in-depth CANDIDATE ONLY.
// Never implicitly execute this script during application generation or boot.
// One reviewed tenant+maker-checker entity, two operator-provisioned SQL login
// roles, and a mapping privately owned by the migration operator.
// The generated applications do NOT yet route tenant requests to those roles.
import {auditedTenantStatePolicy} from "./tenant-state-policy.mjs";

export function tenantRlsRoleCandidateSql(ir){
  if(!Array.isArray(ir?.entities)||ir.entities.length!==1)return null;
  const p=auditedTenantStatePolicy(ir,ir.entities[0]);
  if(!p?.composite)return null;
  const table=p.table;
  // The canonical policy already checks entity identifiers and grammar shape.
  // PostgreSQL truncates identifiers at 63 bytes; fail instead of colliding.
  if(table.length>45)throw Error("UNSAFE_RLS_CANDIDATE: SQL table identifier too long");
  return `-- EXPERIMENTAL OPERATOR-ONLY RLS candidate; NOT installed by generated apps.
-- Explicit operator transaction (same session):
--   BEGIN; SET LOCAL protocolia.rls_role_alpha='protocolia_rls_alpha';
--   SET LOCAL protocolia.rls_role_beta='protocolia_rls_beta';
--   \\i protocolia-tenant-rls-role-candidate.sql
--   INSERT INTO public.protocolia_rls_principal_tenant(principal,tenant_id)
--     VALUES ('protocolia_rls_alpha','org_alpha'),('protocolia_rls_beta','org_beta');
--   COMMIT;
-- Roles must be separate LOGIN roles, with NO elevated privileges, ownership,
-- cross-membership or CREATE on public. The operator MUST be a non-superuser
-- owner of public and the business table, with isolated DB credentials.
-- This does not wire an application connection pool; it proves a SQL boundary.
DO $protocolia_rls_role_preflight$
DECLARE
  alpha TEXT := nullif(current_setting('protocolia.rls_role_alpha',true),'');
  beta TEXT := nullif(current_setting('protocolia.rls_role_beta',true),'');
  alpha_role RECORD;
  beta_role RECORD;
  owner_oid OID := current_user::regrole;
  entity_record RECORD;
BEGIN
  IF alpha IS NULL OR beta IS NULL OR alpha=beta OR
     alpha !~ '^[a-z][a-z0-9_]{1,62}$' OR
     beta !~ '^[a-z][a-z0-9_]{1,62}$' THEN
    RAISE EXCEPTION 'Two distinct explicit safe tenant SQL principals required'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO alpha_role FROM pg_roles WHERE rolname=alpha;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Missing Alpha SQL principal' USING ERRCODE='23514';
  END IF;
  SELECT * INTO beta_role FROM pg_roles WHERE rolname=beta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Missing Beta SQL principal' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid=owner_oid AND
     (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) OR
     NOT EXISTS (SELECT 1 FROM pg_namespace
       WHERE nspname='public' AND nspowner=owner_oid) THEN
    RAISE EXCEPTION 'RLS migrator must be a nonprivileged schema owner'
      USING ERRCODE='23514';
  END IF;
  IF alpha_role.oid=owner_oid OR beta_role.oid=owner_oid OR
     NOT alpha_role.rolcanlogin OR NOT beta_role.rolcanlogin OR
     alpha_role.rolsuper OR beta_role.rolsuper OR
     alpha_role.rolbypassrls OR beta_role.rolbypassrls OR
     alpha_role.rolcreaterole OR beta_role.rolcreaterole OR
     alpha_role.rolcreatedb OR beta_role.rolcreatedb OR
     alpha_role.rolreplication OR beta_role.rolreplication OR
     pg_has_role(alpha_role.oid,owner_oid,'MEMBER') OR
     pg_has_role(beta_role.oid,owner_oid,'MEMBER') OR
     pg_has_role(alpha_role.oid,beta_role.oid,'MEMBER') OR
     pg_has_role(beta_role.oid,alpha_role.oid,'MEMBER') OR
     -- A group membership may allow SET ROLE into an untrusted BYPASSRLS,
     -- table-owning, or CREATEROLE principal. Reject *all* extra memberships.
     EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid<>alpha_role.oid
       AND pg_has_role(alpha_role.oid,r.oid,'MEMBER')) OR
     EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid<>beta_role.oid
       AND pg_has_role(beta_role.oid,r.oid,'MEMBER')) OR
     has_schema_privilege(alpha,'public','CREATE') OR
     has_schema_privilege(beta,'public','CREATE') THEN
    RAISE EXCEPTION 'Unsafe tenant SQL principal privileges or membership'
      USING ERRCODE='23514';
  END IF;
  SELECT oid,relowner,relkind,relrowsecurity,relforcerowsecurity
    INTO entity_record FROM pg_class
    WHERE oid='public.${table}'::regclass;
  IF entity_record.relowner IS DISTINCT FROM owner_oid OR
     entity_record.relkind IS DISTINCT FROM 'r' OR
     entity_record.relrowsecurity OR entity_record.relforcerowsecurity THEN
    RAISE EXCEPTION 'Business table owner, kind or RLS state is unreviewed'
      USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='${table}'
      AND column_name='protocolia_tenant_id' AND data_type='character varying'
      AND is_nullable='NO') THEN
    RAISE EXCEPTION 'Required server-owned tenant column missing'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c,
     LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
     WHERE c.oid=entity_record.oid AND a.grantee<>owner_oid) THEN
    RAISE EXCEPTION 'Business table has an unreviewed preexisting grant'
      USING ERRCODE='23514';
  END IF;
  -- Audit events must follow the same tenant boundary before any application
  -- SQL principal can use the proposed RLS profile. Existing events require a
  -- separately reviewed migration/backfill, never an implicit NULL fallback.
  IF to_regclass('public.protocolia_audit_event') IS NULL OR
     NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.protocolia_audit_event'::regclass
       AND relowner=owner_oid AND relkind='r'
       AND NOT relrowsecurity AND NOT relforcerowsecurity) OR
     EXISTS (SELECT 1 FROM public.protocolia_audit_event) THEN
    RAISE EXCEPTION 'Audit table must be empty, owned and not previously protected'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c,
      LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid='public.protocolia_audit_event'::regclass
      AND a.grantee<>owner_oid) THEN
    RAISE EXCEPTION 'Audit table has unreviewed grants' USING ERRCODE='23514';
  END IF;
  IF to_regclass('public.protocolia_rls_principal_tenant') IS NOT NULL OR
     to_regprocedure('public.protocolia_rls_session_tenant()') IS NOT NULL OR
     EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
       AND tablename='${table}') THEN
    RAISE EXCEPTION 'RLS artifacts already exist; refusing implicit overwrite'
      USING ERRCODE='23514';
  END IF;
END
$protocolia_rls_role_preflight$;
-- The mapping is not readable or editable by the tenant SQL logins.
CREATE TABLE public.protocolia_rls_principal_tenant(
  principal NAME PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL
    CHECK (tenant_id ~ '^[a-z][a-z0-9_-]{1,63}$')
);
REVOKE ALL ON public.protocolia_rls_principal_tenant FROM PUBLIC;
-- SECURITY DEFINER reads the private map using SESSION_USER (the LOGIN
-- identity), not CURRENT_USER (function owner), SET ROLE or any mutable GUC.
CREATE FUNCTION public.protocolia_rls_session_tenant()
RETURNS VARCHAR(64)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $protocolia_rls_lookup$
  SELECT tenant_id FROM public.protocolia_rls_principal_tenant
  WHERE principal=session_user::name
$protocolia_rls_lookup$;
REVOKE ALL ON FUNCTION public.protocolia_rls_session_tenant() FROM PUBLIC;
-- Current v0.7 audit rows have no tenant field. This opt-in candidate only
-- accepts an EMPTY audit table, then sets a database-derived tenant default.
-- A direct SQL caller cannot choose a different tenant, even on INSERT.
ALTER TABLE public.protocolia_audit_event
  ADD COLUMN protocolia_tenant_id VARCHAR(64) NOT NULL
  DEFAULT public.protocolia_rls_session_tenant();
DO $protocolia_rls_role_apply$
DECLARE
  alpha TEXT := current_setting('protocolia.rls_role_alpha',true);
  beta TEXT := current_setting('protocolia.rls_role_beta',true);
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I,%I',alpha,beta);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.protocolia_rls_session_tenant() TO %I,%I',
    alpha,beta);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.${table} TO %I,%I',alpha,beta);
  EXECUTE format('GRANT INSERT ON public.protocolia_audit_event TO %I,%I',alpha,beta);
  EXECUTE format('GRANT USAGE ON SEQUENCE public.protocolia_audit_event_id_seq TO %I,%I',alpha,beta);
  EXECUTE format('CREATE POLICY protocolia_rls_audit_insert ON public.protocolia_audit_event FOR INSERT TO %I,%I WITH CHECK (protocolia_tenant_id=public.protocolia_rls_session_tenant())',alpha,beta);
  EXECUTE format('CREATE POLICY protocolia_rls_read ON public.${table} FOR SELECT TO %I,%I USING (protocolia_tenant_id=public.protocolia_rls_session_tenant())',
    alpha,beta);
  EXECUTE format('CREATE POLICY protocolia_rls_insert ON public.${table} FOR INSERT TO %I,%I WITH CHECK (protocolia_tenant_id=public.protocolia_rls_session_tenant())',
    alpha,beta);
  EXECUTE format('CREATE POLICY protocolia_rls_update ON public.${table} FOR UPDATE TO %I,%I USING (protocolia_tenant_id=public.protocolia_rls_session_tenant()) WITH CHECK (protocolia_tenant_id=public.protocolia_rls_session_tenant())',
    alpha,beta);
END $protocolia_rls_role_apply$;
ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
ALTER TABLE public.protocolia_audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocolia_audit_event FORCE ROW LEVEL SECURITY;
-- Fail closed on any accidentally inherited DELETE/TRUNCATE, ownership,
-- disabled RLS or a second session alias that could bypass this policy.
DO $protocolia_rls_role_post$
DECLARE alpha TEXT:=current_setting('protocolia.rls_role_alpha',true);
        beta TEXT:=current_setting('protocolia.rls_role_beta',true);
        role_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.${table}'::regclass
     AND relrowsecurity AND relforcerowsecurity) OR
     NOT EXISTS (SELECT 1 FROM pg_class
       WHERE oid='public.protocolia_audit_event'::regclass
       AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'RLS policy is not forced' USING ERRCODE='23514';
  END IF;
  FOREACH role_name IN ARRAY ARRAY[alpha,beta] LOOP
    IF has_table_privilege(role_name,'public.${table}','DELETE') OR
       has_table_privilege(role_name,'public.${table}','TRUNCATE') OR
       has_table_privilege(role_name,'public.${table}','TRIGGER') OR
       has_table_privilege(role_name,'public.${table}','REFERENCES') OR
       has_table_privilege(role_name,'public.protocolia_audit_event','SELECT') OR
       has_table_privilege(role_name,'public.protocolia_audit_event','UPDATE') OR
       has_table_privilege(role_name,'public.protocolia_audit_event','DELETE') OR
       has_table_privilege(role_name,'public.protocolia_audit_event','TRUNCATE') OR
       has_table_privilege(role_name,'public.protocolia_rls_principal_tenant','SELECT') OR
       has_table_privilege(role_name,'public.protocolia_rls_principal_tenant','UPDATE') THEN
      RAISE EXCEPTION 'RLS privilege postcondition failed for %',role_name
        USING ERRCODE='23514';
    END IF;
  END LOOP;
END $protocolia_rls_role_post$;
`;
}
