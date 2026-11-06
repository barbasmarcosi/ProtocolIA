// P2 S2/0 — operator-only candidate: bind maker/checker and audit actor to the
// authenticated PostgreSQL SQL LOGIN, not to a forgeable transaction setting.
// Requires an explicitly applied S1 role-RLS candidate on an empty test DB.
// Not a production migration. Does not route generated HTTP requests by human.
import {auditedTenantStatePolicy} from "./tenant-state-policy.mjs";
import {tenantRlsRoleCandidateSql} from "./tenant-rls-role-candidate.mjs";

export function subjectRoleGuardCandidateSql(ir){
  if(!Array.isArray(ir?.entities)||ir.entities.length!==1)return null;
  if(!tenantRlsRoleCandidateSql(ir))return null;
  const entity=ir.entities[0],p=auditedTenantStatePolicy(ir,entity);
  if(!p?.composite)return null;
  const steps=ir.operations.filter(o=>o.entity===entity.name&&o.behavior?.kind==="transition");
  const submit=steps.find(o=>o.behavior.from===p.initial);
  const decide=steps.filter(o=>o!==submit);
  if(!submit||decide.length!==2||decide.some(o=>o.behavior.from!==submit.behavior.to))
    throw Error("S2_UNREVIEWED_MAKER_GRAPH");
  const literals=[p.initial,submit.behavior.to,...decide.map(o=>o.behavior.to)];
  if(!literals.every(x=>typeof x==="string"&&/^[a-z][a-z0-9_]{0,32}$/.test(x)))
    throw Error("S2_UNSAFE_STATE_LITERAL");
  if(p.table.length>32)throw Error("S2_UNSAFE_SQL_IDENTIFIER_LENGTH");
  const q=x=>"'"+x+"'";
  const table=p.table,col=p.stateColumn,initial=q(p.initial),
    reviewed=q(submit.behavior.to),ends=decide.map(o=>q(o.behavior.to)).join(",");
  return `-- P2 S2/0 OPERATOR-ONLY. Requires installed S1 tenant RLS, matching owner,
-- 2 additional independently authenticated SQL logins, and 4 operator-reviewed
-- human subjects. No generated app executes or activates this automatically.
-- Explicit operator transaction example:
-- BEGIN;
-- SET LOCAL protocolia.s2_alpha_checker='protocolia_s2_alpha_checker';
-- SET LOCAL protocolia.s2_beta_checker='protocolia_s2_beta_checker';
-- SET LOCAL protocolia.s2_alpha_maker_subject='alpha-maker';
-- SET LOCAL protocolia.s2_alpha_checker_subject='alpha-checker';
-- SET LOCAL protocolia.s2_beta_maker_subject='beta-maker';
-- SET LOCAL protocolia.s2_beta_checker_subject='beta-checker';
-- \\\\i protocolia-subject-role-guard-candidate.sql
-- COMMIT;
DO $protocolia_s2_preflight$
DECLARE
  ca TEXT:=nullif(current_setting('protocolia.s2_alpha_checker',true),'');
  cb TEXT:=nullif(current_setting('protocolia.s2_beta_checker',true),'');
  subjects TEXT[]:=ARRAY[
    nullif(current_setting('protocolia.s2_alpha_maker_subject',true),''),
    nullif(current_setting('protocolia.s2_alpha_checker_subject',true),''),
    nullif(current_setting('protocolia.s2_beta_maker_subject',true),''),
    nullif(current_setting('protocolia.s2_beta_checker_subject',true),'')
  ];
  role_name TEXT;
  role_record RECORD;
  owner_oid OID:=current_user::regrole;
BEGIN
  IF ca IS NULL OR cb IS NULL OR ca=cb OR
     ca IN ('protocolia_rls_alpha','protocolia_rls_beta') OR
     cb IN ('protocolia_rls_alpha','protocolia_rls_beta') OR
     ca !~ '^[a-z][a-z0-9_]{1,62}$' OR cb !~ '^[a-z][a-z0-9_]{1,62}$' OR
     EXISTS (SELECT 1 FROM unnest(subjects) s
       WHERE s IS NULL OR s !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,127}$') OR
     subjects[1]=subjects[2] OR subjects[3]=subjects[4] THEN
    RAISE EXCEPTION 'Four reviewed maker/checker identities and two distinct checker LOGIN roles required'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=owner_oid AND
     (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) OR
     NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.${table}'::regclass
       AND relowner=owner_oid AND relrowsecurity AND relforcerowsecurity) OR
     NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.protocolia_audit_event'::regclass
       AND relowner=owner_oid AND relrowsecurity AND relforcerowsecurity) OR
     NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='public' AND nspowner=owner_oid) OR
     to_regprocedure('public.protocolia_mc_${table}_guard()') IS NULL OR
     to_regprocedure('public.protocolia_rls_session_tenant()') IS NULL OR
     to_regclass('public.protocolia_rls_principal_tenant') IS NULL OR
     to_regclass('public.protocolia_s2_principal_subject') IS NOT NULL OR
     to_regprocedure('public.protocolia_s2_session_subject()') IS NOT NULL OR
     to_regprocedure('public.protocolia_s2_human_${table}_guard()') IS NOT NULL OR
     EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.${table}'::regclass
       AND tgname='protocolia_s2_human_${table}_trigger') THEN
    RAISE EXCEPTION 'S2 must extend only reviewed installed S1 and maker guard'
      USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.protocolia_rls_principal_tenant
      WHERE principal='protocolia_rls_alpha' AND tenant_id='org_alpha') OR
     NOT EXISTS(SELECT 1 FROM public.protocolia_rls_principal_tenant
      WHERE principal='protocolia_rls_beta' AND tenant_id='org_beta') THEN
    RAISE EXCEPTION 'Existing S1 SQL identities do not match tenant mapping'
      USING ERRCODE='23514';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['protocolia_rls_alpha','protocolia_rls_beta',ca,cb] LOOP
    SELECT * INTO role_record FROM pg_roles WHERE rolname=role_name;
    IF NOT FOUND OR NOT role_record.rolcanlogin OR role_record.rolsuper OR
       role_record.rolbypassrls OR role_record.rolcreaterole OR
       role_record.rolcreatedb OR role_record.rolreplication OR
       role_record.oid=owner_oid OR
       has_schema_privilege(role_name,'public','CREATE') OR
       EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid<>role_record.oid
         AND pg_has_role(role_record.oid,r.oid,'MEMBER')) THEN
      RAISE EXCEPTION 'S2 unreviewed SQL login privilege or membership'
        USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.protocolia_rls_principal_tenant
      WHERE principal IN (ca::name,cb::name)) THEN
    RAISE EXCEPTION 'Checker SQL principal already bound; refusing replacement'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename='${table}' AND
        policyname NOT IN ('protocolia_rls_read','protocolia_rls_insert','protocolia_rls_update')) OR
     EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
       AND tablename='protocolia_audit_event' AND policyname<>'protocolia_rls_audit_insert') THEN
    RAISE EXCEPTION 'Unreviewed existing row policies' USING ERRCODE='23514';
  END IF;
END $protocolia_s2_preflight$;
-- Secret of identity binding is the database-authenticated session principal,
-- never a client-selected GUC or HTTP header. Roles are provisioned by operator.
CREATE TABLE public.protocolia_s2_principal_subject(
  principal NAME PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  subject VARCHAR(128) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tenant_id,subject)
);
REVOKE ALL ON public.protocolia_s2_principal_subject FROM PUBLIC;
DO $protocolia_s2_install$
DECLARE
  ca TEXT:=current_setting('protocolia.s2_alpha_checker',true);
  cb TEXT:=current_setting('protocolia.s2_beta_checker',true);
BEGIN
  INSERT INTO public.protocolia_rls_principal_tenant(principal,tenant_id)
  VALUES (ca::name,'org_alpha'),(cb::name,'org_beta');
  INSERT INTO public.protocolia_s2_principal_subject(principal,tenant_id,subject)
  VALUES
    ('protocolia_rls_alpha','org_alpha',current_setting('protocolia.s2_alpha_maker_subject')),
    (ca::name,'org_alpha',current_setting('protocolia.s2_alpha_checker_subject')),
    ('protocolia_rls_beta','org_beta',current_setting('protocolia.s2_beta_maker_subject')),
    (cb::name,'org_beta',current_setting('protocolia.s2_beta_checker_subject'));
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I,%I',ca,cb);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.protocolia_rls_session_tenant() TO %I,%I',ca,cb);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.${table} TO %I,%I',ca,cb);
  EXECUTE format('GRANT INSERT ON public.protocolia_audit_event TO %I,%I',ca,cb);
  EXECUTE format('GRANT USAGE ON SEQUENCE public.protocolia_audit_event_id_seq TO %I,%I',ca,cb);
  EXECUTE format('ALTER POLICY protocolia_rls_read ON public.${table} TO protocolia_rls_alpha,protocolia_rls_beta,%I,%I',ca,cb);
  EXECUTE format('ALTER POLICY protocolia_rls_insert ON public.${table} TO protocolia_rls_alpha,protocolia_rls_beta,%I,%I',ca,cb);
  EXECUTE format('ALTER POLICY protocolia_rls_update ON public.${table} TO protocolia_rls_alpha,protocolia_rls_beta,%I,%I',ca,cb);
  EXECUTE format('ALTER POLICY protocolia_rls_audit_insert ON public.protocolia_audit_event TO protocolia_rls_alpha,protocolia_rls_beta,%I,%I',ca,cb);
END $protocolia_s2_install$;
CREATE FUNCTION public.protocolia_s2_session_subject()
RETURNS VARCHAR(128)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $protocolia_s2_subject$
  SELECT subject FROM public.protocolia_s2_principal_subject
  WHERE principal=session_user::name AND
    tenant_id=public.protocolia_rls_session_tenant() AND
    active IS TRUE
$protocolia_s2_subject$;
REVOKE ALL ON FUNCTION public.protocolia_s2_session_subject() FROM PUBLIC;
DO $protocolia_s2_grant_subject$
DECLARE ca TEXT:=current_setting('protocolia.s2_alpha_checker',true);
        cb TEXT:=current_setting('protocolia.s2_beta_checker',true);
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.protocolia_s2_session_subject() TO protocolia_rls_alpha,protocolia_rls_beta,%I,%I',ca,cb);
END $protocolia_s2_grant_subject$;
-- S2.2 operator-only live revocation. The private owner changes active;
-- SQL-login clients have no UPDATE/SELECT grant on that mapping. An already
-- authenticated, previously pooled subject loses SELECT, INSERT, UPDATE and
-- audit INSERT on the next PostgreSQL statement. Both the application and
-- independent DB policies require a still-active human identity.
ALTER POLICY protocolia_rls_read ON public.${table}
  USING (protocolia_tenant_id=public.protocolia_rls_session_tenant()
    AND public.protocolia_s2_session_subject() IS NOT NULL);
ALTER POLICY protocolia_rls_insert ON public.${table}
  WITH CHECK (protocolia_tenant_id=public.protocolia_rls_session_tenant()
    AND public.protocolia_s2_session_subject() IS NOT NULL);
ALTER POLICY protocolia_rls_update ON public.${table}
  USING (protocolia_tenant_id=public.protocolia_rls_session_tenant()
    AND public.protocolia_s2_session_subject() IS NOT NULL)
  WITH CHECK (protocolia_tenant_id=public.protocolia_rls_session_tenant()
    AND public.protocolia_s2_session_subject() IS NOT NULL);
ALTER POLICY protocolia_rls_audit_insert ON public.protocolia_audit_event
  WITH CHECK (protocolia_tenant_id=public.protocolia_rls_session_tenant()
    AND public.protocolia_s2_session_subject() IS NOT NULL);
CREATE FUNCTION public.protocolia_s2_human_${table}_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $protocolia_s2_guard$
DECLARE actor TEXT:=public.protocolia_s2_session_subject();
BEGIN
  IF actor IS NULL OR length(actor)>128 THEN
    RAISE EXCEPTION 'Human SQL principal not bound to a verified subject'
      USING ERRCODE='23514';
  END IF;
  IF NEW.${col} IS DISTINCT FROM OLD.${col} THEN
    IF OLD.${col}=${initial} AND NEW.${col}=${reviewed} AND
       OLD.protocolia_submitted_by IS NULL AND
       NEW.protocolia_submitted_by=actor THEN
      RETURN NEW;
    END IF;
    IF OLD.${col}=${reviewed} AND NEW.${col} IN (${ends}) AND
       OLD.protocolia_submitted_by IS NOT NULL AND
       NEW.protocolia_submitted_by=OLD.protocolia_submitted_by AND
       actor<>OLD.protocolia_submitted_by THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'SQL login not authorized as maker or independent checker'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $protocolia_s2_guard$;
CREATE TRIGGER protocolia_s2_human_${table}_trigger
BEFORE UPDATE ON public.${table}
FOR EACH ROW EXECUTE FUNCTION public.protocolia_s2_human_${table}_guard();
CREATE FUNCTION public.protocolia_s2_audit_actor_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $protocolia_s2_audit_guard$
BEGIN
  IF public.protocolia_s2_session_subject() IS NULL OR
     NEW.actor IS DISTINCT FROM public.protocolia_s2_session_subject() THEN
    RAISE EXCEPTION 'Audit actor must equal authenticated SQL subject'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $protocolia_s2_audit_guard$;
CREATE TRIGGER protocolia_s2_audit_actor_trigger
BEFORE INSERT ON public.protocolia_audit_event
FOR EACH ROW EXECUTE FUNCTION public.protocolia_s2_audit_actor_guard();
-- This prevents subject impersonation through SQL GUC, not fabricated event
-- content by a compromised caller using its OWN identity. Not nonrepudiation.
`;
}
