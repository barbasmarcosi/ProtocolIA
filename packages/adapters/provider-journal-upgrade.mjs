// S2c-1c4k: reviewable, additive, operator-applied PostgreSQL hardening
// for an EXISTING generated provider journal. Never run this during app build,
// boot, or on an unreviewed database. A DO block is one atomic statement:
// a missing/mutated historical guard aborts all three trigger changes.
export function providerJournalTruncateUpgradeSql() {
  return `-- ProtocolIA S2c-1c4k: append-only provider journal hardening.
-- Apply with a separately authorized migration principal after a verified
-- backup and a rehearsal against a populated copy. No payment mutations.
-- Existing V1/Flyway/Nest migration history must remain unchanged.
DO $protocolia_provider_upgrade$
DECLARE
  journal TEXT;
  row_guard TEXT;
  bulk_guard TEXT;
  journal_oid OID;
  guard_oid OID;
  existing RECORD;
BEGIN
  -- Serialize concurrent upgrade attempts, including a repeated invocation.
  PERFORM pg_advisory_xact_lock(1927400411);
  -- The advisory lock coordinates upgrades; real table locks also exclude
  -- concurrent DML/TRUNCATE by clients unaware of our advisory lock.
  -- NOWAIT rejects an active writer instead of risking an unbounded pause.
  EXECUTE 'LOCK TABLE public.protocolia_provider_envelope_inbox,
    public.protocolia_provider_receipt_candidate,
    public.protocolia_provider_lifecycle_observation
    IN SHARE ROW EXCLUSIVE MODE NOWAIT';
  SELECT to_regprocedure('public.protocolia_provider_envelope_immutable()')::oid
    INTO guard_oid;
  IF guard_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=guard_oid
      AND p.prorettype='pg_catalog.trigger'::regtype
      AND NOT p.prosecdef
      AND position('Provider envelope inbox is append-only'
        IN pg_get_functiondef(p.oid))>0
      AND position('23514' IN pg_get_functiondef(p.oid))>0
  ) THEN
    RAISE EXCEPTION 'Provider journal immutable function drift/missing'
      USING ERRCODE='23514';
  END IF;
  -- Validate the complete historical guard set BEFORE creating anything.
  FOREACH journal IN ARRAY ARRAY[
    'protocolia_provider_envelope_inbox',
    'protocolia_provider_receipt_candidate',
    'protocolia_provider_lifecycle_observation'
  ] LOOP
    row_guard:=CASE journal
      WHEN 'protocolia_provider_envelope_inbox'
        THEN 'protocolia_provider_envelope_immutable_guard'
      ELSE journal||'_immutable_guard' END;
    SELECT c.oid INTO journal_oid FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=journal AND c.relkind='r';
    IF journal_oid IS NULL THEN
      RAISE EXCEPTION 'Provider journal table missing or incompatible: %',journal
        USING ERRCODE='23514';
    END IF;
    SELECT t.tgfoid,t.tgtype,t.tgenabled INTO existing
      FROM pg_trigger t WHERE t.tgrelid=journal_oid
        AND t.tgname=row_guard AND NOT t.tgisinternal;
    IF NOT FOUND OR existing.tgfoid IS DISTINCT FROM guard_oid OR
       existing.tgtype IS DISTINCT FROM 27 OR
       existing.tgenabled IS DISTINCT FROM 'O' THEN
      RAISE EXCEPTION 'Provider journal row guard missing/drifted: %',journal
        USING ERRCODE='23514';
    END IF;
    bulk_guard:=row_guard||'_truncate';
    SELECT t.tgfoid,t.tgtype,t.tgenabled INTO existing
      FROM pg_trigger t WHERE t.tgrelid=journal_oid
        AND t.tgname=bulk_guard AND NOT t.tgisinternal;
    IF FOUND AND (existing.tgfoid IS DISTINCT FROM guard_oid OR
       existing.tgtype IS DISTINCT FROM 34 OR
       existing.tgenabled IS DISTINCT FROM 'O') THEN
      RAISE EXCEPTION 'Provider journal TRUNCATE guard drifted: %',journal
        USING ERRCODE='23514';
    END IF;
  END LOOP;
  -- Every historical object is valid. Add only the missing statement guards.
  FOREACH journal IN ARRAY ARRAY[
    'protocolia_provider_envelope_inbox',
    'protocolia_provider_receipt_candidate',
    'protocolia_provider_lifecycle_observation'
  ] LOOP
    row_guard:=CASE journal
      WHEN 'protocolia_provider_envelope_inbox'
        THEN 'protocolia_provider_envelope_immutable_guard'
      ELSE journal||'_immutable_guard' END;
    bulk_guard:=row_guard||'_truncate';
    SELECT c.oid INTO journal_oid FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=journal AND c.relkind='r';
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=journal_oid AND t.tgname=bulk_guard AND NOT t.tgisinternal)
    THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.protocolia_provider_envelope_immutable()',
        bulk_guard,journal);
    END IF;
  END LOOP;
END $protocolia_provider_upgrade$;
`;
}
