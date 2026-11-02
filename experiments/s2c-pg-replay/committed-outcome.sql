-- Disposable upgrade applied AFTER the original 19-row replay fixture.
-- No production migration, financial settlement or external provider calls.
BEGIN;
SET ROLE protocolia_s2c_owner;
CREATE TABLE protocolia_s2c_replay.batch_receipt (
  tenant_id text COLLATE "C" NOT NULL,
  provider_id text COLLATE "C" NOT NULL,
  batch_sha256 text COLLATE "C" NOT NULL CHECK (batch_sha256 ~ '^[0-9a-f]{64}$'),
  order_id text COLLATE "C" NOT NULL,
  statement_sha256 text COLLATE "C" NOT NULL,
  events jsonb NOT NULL,
  event_count integer NOT NULL CHECK (event_count BETWEEN 1 AND 512),
  committed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, provider_id, batch_sha256),
  CHECK (jsonb_typeof(events) = 'array'),
  CHECK (jsonb_array_length(events) = event_count)
);
CREATE TRIGGER receipt_no_mutation BEFORE UPDATE OR DELETE
  ON protocolia_s2c_replay.batch_receipt FOR EACH ROW
  EXECUTE FUNCTION protocolia_s2c_replay.reject_mutation();
CREATE TRIGGER receipt_no_truncate BEFORE TRUNCATE
  ON protocolia_s2c_replay.batch_receipt FOR EACH STATEMENT
  EXECUTE FUNCTION protocolia_s2c_replay.reject_mutation();

-- The existing claim function validates every field and writes event + audit
-- atomically. The receipt is inserted in the SAME transaction, never later.
CREATE FUNCTION protocolia_s2c_replay.claim_with_receipt(
  v_provider text, v_order text, v_statement_sha256 text, v_events jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, protocolia_s2c_replay, pg_temp AS $fn$
DECLARE
  v_tenant text;
  n integer;
  fingerprint text;
BEGIN
  n := protocolia_s2c_replay.claim_verified_batch(
    v_provider, v_order, v_statement_sha256, v_events);
  SELECT tenant_id INTO STRICT v_tenant
    FROM protocolia_s2c_replay.principal_binding
    WHERE principal_name = session_user;
  fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'provider', v_provider, 'order', v_order,
    'statement', v_statement_sha256, 'events', v_events)::text, 'UTF8')), 'hex');
  INSERT INTO protocolia_s2c_replay.batch_receipt
    (tenant_id,provider_id,batch_sha256,order_id,statement_sha256,events,event_count)
  VALUES (v_tenant,v_provider,fingerprint,v_order,v_statement_sha256,v_events,n);
  RETURN n;
END $fn$;

-- Read-only, principal-scoped acknowledgement recovery. A matching receipt
-- alone is insufficient: every event AND audit must still match exactly.
-- Returns 'not_observed' when no requested event ID is visible in this
-- snapshot. This is NOT proof that no in-flight transaction exists. Partial,
-- conflicting, legacy/unreceipted, or corrupt evidence fails closed.
CREATE FUNCTION protocolia_s2c_replay.inspect_committed_batch(
  v_provider text, v_order text, v_statement_sha256 text, v_events jsonb
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, protocolia_s2c_replay, pg_temp AS $fn$
DECLARE
  v_tenant text;
  v_bound_provider text;
  fingerprint text;
  item jsonb;
  v_event text;
  v_amount text;
  seen text[] := ARRAY[]::text[];
  matches integer;
  good integer;
  found_receipt boolean;
  receipt_matches boolean;
BEGIN
  IF v_provider IS NULL OR v_provider !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR v_order IS NULL OR v_order !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR v_statement_sha256 IS NULL OR v_statement_sha256 !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(v_events) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid batch lookup' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(v_events) NOT BETWEEN 1 AND 512
  THEN RAISE EXCEPTION 'Invalid batch size' USING ERRCODE='23514'; END IF;
  SELECT tenant_id,provider_id INTO v_tenant,v_bound_provider
    FROM protocolia_s2c_replay.principal_binding WHERE principal_name=session_user;
  IF v_tenant IS NULL OR v_bound_provider IS DISTINCT FROM v_provider THEN
    RAISE EXCEPTION 'Database principal is not bound to this provider'
      USING ERRCODE='42501';
  END IF;
  fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'provider',v_provider,'order',v_order,
    'statement',v_statement_sha256,'events',v_events)::text,'UTF8')),'hex');
  SELECT true,
    (r.events = v_events AND r.order_id = v_order
     AND r.statement_sha256 = v_statement_sha256
     AND r.event_count = jsonb_array_length(v_events))
    INTO found_receipt,receipt_matches
    FROM protocolia_s2c_replay.batch_receipt r
    WHERE r.tenant_id=v_tenant AND r.provider_id=v_provider
      AND r.batch_sha256=fingerprint;
  IF found_receipt IS TRUE AND receipt_matches IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Batch receipt mismatch' USING ERRCODE='23514';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(v_events) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 6
      OR jsonb_typeof(item->'providerId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'eventId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'transactionId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'kind') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'currency') IS DISTINCT FROM 'string'
    THEN RAISE EXCEPTION 'Invalid lookup event shape' USING ERRCODE='23514'; END IF;
    v_event := item->>'eventId';
    v_amount := item->>'amount';
    IF item->>'providerId' IS DISTINCT FROM v_provider
      OR v_event !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      OR v_event = ANY(seen)
      OR item->>'transactionId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      OR item->>'kind' NOT IN ('capture','refund','chargeback')
      OR item->>'currency' !~ '^[A-Z]{3}$'
      OR v_amount !~ '^(0|[1-9][0-9]*)([.][0-9]+)?$'
      OR length(split_part(v_amount,'.',1)) > 32
      OR length(split_part(v_amount,'.',2)) > 6
      OR v_amount::numeric <= 0
    THEN RAISE EXCEPTION 'Invalid lookup event' USING ERRCODE='23514'; END IF;
    seen := array_append(seen,v_event);
    SELECT count(*) INTO matches FROM protocolia_s2c_replay.claim c
      WHERE c.tenant_id=v_tenant AND c.provider_id=v_provider AND c.event_id=v_event;
    IF found_receipt IS DISTINCT FROM true THEN
      IF matches <> 0 THEN
        RAISE EXCEPTION 'Conflicting or unreceipted event evidence'
          USING ERRCODE='23505';
      END IF;
    ELSE
      SELECT count(*) INTO good
      FROM protocolia_s2c_replay.claim c
      JOIN protocolia_s2c_replay.audit a
        ON a.tenant_id=c.tenant_id AND a.provider_id=c.provider_id
          AND a.event_id=c.event_id
      WHERE c.tenant_id=v_tenant AND c.provider_id=v_provider AND c.event_id=v_event
        AND c.order_id=v_order AND a.order_id=v_order
        AND c.statement_sha256=v_statement_sha256
        AND a.statement_sha256=v_statement_sha256
        AND c.transaction_id=item->>'transactionId'
        AND a.transaction_id=c.transaction_id
        AND c.kind=item->>'kind' AND a.kind=c.kind
        AND c.amount_text=v_amount AND a.amount_text=v_amount
        AND c.amount=v_amount::numeric
        AND c.currency=item->>'currency' AND a.currency=c.currency;
      IF good <> 1 THEN
        RAISE EXCEPTION 'Incomplete or inconsistent committed evidence'
          USING ERRCODE='23514';
      END IF;
    END IF;
  END LOOP;
  IF found_receipt IS TRUE THEN RETURN 'committed'; END IF;
  RETURN 'not_observed';
END $fn$;

-- Old direct writer cannot bypass the atomic receipt after upgrade.
REVOKE ALL ON FUNCTION protocolia_s2c_replay.claim_verified_batch(text,text,text,jsonb)
  FROM protocolia_s2c_runtime;
REVOKE ALL ON FUNCTION protocolia_s2c_replay.claim_with_receipt(text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION protocolia_s2c_replay.inspect_committed_batch(text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON TABLE protocolia_s2c_replay.batch_receipt FROM PUBLIC;
GRANT EXECUTE ON FUNCTION protocolia_s2c_replay.claim_with_receipt(text,text,text,jsonb)
  TO protocolia_s2c_runtime;
GRANT EXECUTE ON FUNCTION protocolia_s2c_replay.inspect_committed_batch(text,text,text,jsonb)
  TO protocolia_s2c_runtime;
RESET ROLE;
COMMIT;
