// S2c-1c4l: opt-in, operator-reviewed runtime/migration DB privilege split.
// Never run this during generation, application boot or ordinary migrations.
// The operator must own all provider journal objects and supply a pre-created,
// unprivileged runtime role through a transaction-local custom GUC.
export function providerJournalRuntimeIsolationSql() {
  return `-- ProtocolIA S2c-1c4l: isolate synthetic provider journal runtime access.
-- Operator-only; run after S2c-1c4k with a verified backup and restored rehearsal.
-- Example (same psql session): BEGIN; SET LOCAL protocolia.provider_runtime_role =
-- 'protocolia_runtime'; \\i protocolia-provider-journal-runtime-isolation.sql; COMMIT;
-- The runtime role must not own or inherit ownership of any provider objects.
-- Never execute this from an app connection or grant runtime schema CREATE.
DO $protocolia_provider_runtime_acl$
DECLARE
  runtime_role TEXT := nullif(current_setting('protocolia.provider_runtime_role',true),'');
  runtime_oid OID;
  operator_oid OID := current_user::regrole;
  role_record RECORD;
  journal TEXT;
  journal_oid OID;
  guard_oid OID;
  row_guard TEXT;
  bulk_guard TEXT;
  guard_record RECORD;
  signature TEXT;
  function_oid OID;
  function_owner OID;
BEGIN
  IF runtime_role IS NULL OR runtime_role !~ '^[a-z][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'Missing or unsafe provider runtime role'
      USING ERRCODE='23514';
  END IF;
  SELECT oid,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
    INTO role_record FROM pg_roles WHERE rolname=runtime_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider runtime role does not exist'
      USING ERRCODE='23514';
  END IF;
  runtime_oid:=role_record.oid;
  -- SECURITY DEFINER must NEVER elevate the app to a superuser/CREATEROLE
  -- owner. A dedicated, unprivileged migration owner is mandatory.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid=operator_oid AND
    (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Provider migration owner has elevated privileges'
      USING ERRCODE='23514';
  END IF;
  IF runtime_oid=operator_oid OR role_record.rolsuper OR
     role_record.rolcreaterole OR role_record.rolcreatedb OR
     role_record.rolreplication OR role_record.rolbypassrls OR
     pg_has_role(runtime_oid,operator_oid,'MEMBER') OR
     has_schema_privilege(runtime_role,'public','CREATE') THEN
    RAISE EXCEPTION 'Provider runtime role has elevated or owner privileges'
      USING ERRCODE='23514';
  END IF;
  -- SECURITY DEFINER functions resolve generated relations in public.
  -- Its owner must be the same dedicated migration principal: a different
  -- owner could grant CREATE to an attacker after a one-time ACL preflight.
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace n
      WHERE n.nspname='public' AND n.nspowner=operator_oid
  ) THEN
    RAISE EXCEPTION 'Provider public schema owner is not migration owner'
      USING ERRCODE='23514';
  END IF;
  -- Checking only PUBLIC or the runtime role misses a third party with
  -- CREATE in the trusted search_path. Reject ANY explicit CREATE grant to
  -- another principal, including a group or a currently unused login role.
  -- The schema owner's implicit CREATE privilege remains valid.
  IF EXISTS (
    SELECT 1 FROM pg_namespace n,
      LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname='public' AND a.privilege_type='CREATE'
      AND a.grantee<>operator_oid
  ) THEN
    RAISE EXCEPTION 'Public schema permits untrusted CREATE'
      USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(1927400411);
  EXECUTE 'LOCK TABLE public.protocolia_provider_envelope_inbox,
    public.protocolia_provider_receipt_candidate,
    public.protocolia_provider_lifecycle_observation
    IN SHARE ROW EXCLUSIVE MODE NOWAIT';
  SELECT to_regprocedure('public.protocolia_provider_envelope_immutable()')::oid
    INTO guard_oid;
  IF guard_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=guard_oid
      AND p.proowner=operator_oid AND NOT p.prosecdef
      AND p.prorettype='pg_catalog.trigger'::regtype
      AND position('Provider envelope inbox is append-only'
        IN pg_get_functiondef(p.oid))>0
      AND position('23514' IN pg_get_functiondef(p.oid))>0
  ) THEN
    RAISE EXCEPTION 'Provider immutable function missing, foreign or drifted'
      USING ERRCODE='23514';
  END IF;
  -- Preflight every object BEFORE any ALTER, GRANT or REVOKE. Both historical
  -- row guards and upgraded TRUNCATE guards must be active and trusted.
  FOREACH journal IN ARRAY ARRAY[
    'protocolia_provider_envelope_inbox',
    'protocolia_provider_receipt_candidate',
    'protocolia_provider_lifecycle_observation'
  ] LOOP
    SELECT c.oid INTO journal_oid FROM pg_class c JOIN pg_namespace n
      ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relname=journal AND c.relkind='r' AND c.relowner=operator_oid;
    IF journal_oid IS NULL THEN
      RAISE EXCEPTION 'Provider journal missing or not owned by operator: %',journal
        USING ERRCODE='23514';
    END IF;
    -- Runtime/PUBLIC grants are explicitly revoked below. A third-party
    -- grant must NOT survive: even a SELECT leaks evidence, and INSERT can
    -- fabricate immutable-looking records without using a vetted function.
    -- Reject rather than silently revoke unrelated operator grants.
    IF EXISTS (
      SELECT 1 FROM pg_class c,
        LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=journal_oid
        AND a.grantee NOT IN (operator_oid,runtime_oid,0)
    ) THEN
      RAISE EXCEPTION 'Provider journal has unrelated privilege grantee: %',journal
        USING ERRCODE='23514';
    END IF;
    row_guard:=CASE journal WHEN 'protocolia_provider_envelope_inbox'
      THEN 'protocolia_provider_envelope_immutable_guard'
      ELSE journal||'_immutable_guard' END;
    bulk_guard:=left(row_guard||'_truncate',63);
    SELECT t.tgfoid,t.tgtype,t.tgenabled INTO guard_record
      FROM pg_trigger t WHERE t.tgrelid=journal_oid
        AND t.tgname=row_guard AND NOT t.tgisinternal;
    IF NOT FOUND OR guard_record.tgfoid IS DISTINCT FROM guard_oid OR
       guard_record.tgtype IS DISTINCT FROM 27 OR
       guard_record.tgenabled IS DISTINCT FROM 'O' THEN
      RAISE EXCEPTION 'Provider journal row guard drifted: %',journal
        USING ERRCODE='23514';
    END IF;
    SELECT t.tgfoid,t.tgtype,t.tgenabled INTO guard_record
      FROM pg_trigger t WHERE t.tgrelid=journal_oid
        AND t.tgname=bulk_guard AND NOT t.tgisinternal;
    IF NOT FOUND OR guard_record.tgfoid IS DISTINCT FROM guard_oid OR
       guard_record.tgtype IS DISTINCT FROM 34 OR
       guard_record.tgenabled IS DISTINCT FROM 'O' THEN
      RAISE EXCEPTION 'Provider journal TRUNCATE guard drifted: %',journal
        USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
    'protocolia_record_provider_envelope_digest(text,text,text)',
    'protocolia_record_provider_receipt_candidate(text,text,text,text,text,numeric)',
    'protocolia_record_provider_lifecycle_observation(text,text,text,text,text,text,numeric,numeric,text)',
    'protocolia_provider_lifecycle_causal_projection(text)',
    'protocolia_provider_receipt_integrity_projection(text)'
  ] LOOP
    SELECT p.oid,p.proowner INTO function_oid,function_owner FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.'||signature);
    IF function_oid IS NULL OR function_owner<>operator_oid THEN
      RAISE EXCEPTION 'Provider function missing or not owned by operator: %',signature
        USING ERRCODE='23514';
    END IF;
  END LOOP;
  -- All preconditions hold. Run inside this single atomic DO statement.
  FOREACH journal IN ARRAY ARRAY[
    'protocolia_provider_envelope_inbox',
    'protocolia_provider_receipt_candidate',
    'protocolia_provider_lifecycle_observation'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',journal);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',journal,runtime_role);
  END LOOP;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I',runtime_role);
  FOREACH signature IN ARRAY ARRAY[
    'protocolia_record_provider_envelope_digest(text,text,text)',
    'protocolia_record_provider_receipt_candidate(text,text,text,text,text,numeric)',
    'protocolia_record_provider_lifecycle_observation(text,text,text,text,text,text,numeric,numeric,text)',
    'protocolia_provider_lifecycle_causal_projection(text)',
    'protocolia_provider_receipt_integrity_projection(text)'
  ] LOOP
    -- No table DML is granted to runtime. Only pinned, parameterized functions
    -- can insert/read; temp-schema shadowing is prevented by search_path order.
    EXECUTE format('ALTER FUNCTION public.%s SECURITY DEFINER',signature);
    EXECUTE format('ALTER FUNCTION public.%s SET search_path TO pg_catalog, public, pg_temp',signature);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC',signature);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %I',signature,runtime_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO %I',signature,runtime_role);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.protocolia_provider_envelope_immutable() FROM PUBLIC';
  EXECUTE format('REVOKE ALL ON FUNCTION public.protocolia_provider_envelope_immutable() FROM %I',runtime_role);
  -- Fail closed on privileges inherited from other groups, which direct
  -- REVOKE from runtime cannot remove. A failed postcondition rolls back all.
  FOREACH journal IN ARRAY ARRAY[
    'protocolia_provider_envelope_inbox',
    'protocolia_provider_receipt_candidate',
    'protocolia_provider_lifecycle_observation'
  ] LOOP
    IF has_table_privilege(runtime_role,'public.'||journal,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'Provider runtime inherited direct journal access: %',journal
        USING ERRCODE='23514';
    END IF;
    -- After revoking PUBLIC/runtime, ONLY the trusted owner may retain any
    -- explicit table privilege. This also checks new PG privilege classes.
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
        LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE n.nspname='public' AND c.relname=journal
        AND a.grantee<>operator_oid
    ) THEN
      RAISE EXCEPTION 'Provider journal ACL postcondition failed: %',journal
        USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
    'protocolia_record_provider_envelope_digest(text,text,text)',
    'protocolia_record_provider_receipt_candidate(text,text,text,text,text,numeric)',
    'protocolia_record_provider_lifecycle_observation(text,text,text,text,text,text,numeric,numeric,text)',
    'protocolia_provider_lifecycle_causal_projection(text)',
    'protocolia_provider_receipt_integrity_projection(text)'
  ] LOOP
    IF NOT has_function_privilege(runtime_role,'public.'||signature,'EXECUTE') THEN
      RAISE EXCEPTION 'Provider runtime missing required function access: %',signature
        USING ERRCODE='23514';
    END IF;
    -- An old explicit grant to an unrelated role would become a backdoor
    -- into SECURITY DEFINER, even after PUBLIC EXECUTE is revoked.
    IF EXISTS (
      SELECT 1 FROM pg_proc p,
        LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=to_regprocedure('public.'||signature)
        AND a.privilege_type='EXECUTE'
        AND a.grantee NOT IN (operator_oid,runtime_oid)
    ) THEN
      RAISE EXCEPTION 'Unexpected provider function EXECUTE grantee: %',signature
        USING ERRCODE='23514';
    END IF;
  END LOOP;
END $protocolia_provider_runtime_acl$;
`;
}
