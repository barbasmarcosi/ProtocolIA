-- S2c research proof: transactional, provider-scoped event replay and audit.
-- NOT a production migration or an external provider/bank identity assertion.
-- Apply only to an isolated disposable PostgreSQL database.
-- The owner cannot log in; the untrusted/runtime roles own no data objects.
-- An authenticated service role may be granted membership in runtime only
-- after independently establishing the caller's identity (not done here).
BEGIN;
CREATE ROLE protocolia_s2c_owner NOLOGIN NOINHERIT;
CREATE ROLE protocolia_s2c_runtime NOLOGIN NOINHERIT;
CREATE ROLE protocolia_s2c_untrusted NOLOGIN NOINHERIT;
CREATE SCHEMA protocolia_s2c_replay AUTHORIZATION protocolia_s2c_owner;
REVOKE ALL ON SCHEMA protocolia_s2c_replay FROM PUBLIC;
SET ROLE protocolia_s2c_owner;
CREATE TABLE protocolia_s2c_replay.claim (
  provider_id text COLLATE "C" NOT NULL,
  event_id text COLLATE "C" NOT NULL,
  order_id text COLLATE "C" NOT NULL,
  statement_sha256 text COLLATE "C" NOT NULL,
  transaction_id text COLLATE "C" NOT NULL,
  kind text COLLATE "C" NOT NULL CHECK (kind IN ('capture','refund','chargeback')),
  amount_text text COLLATE "C" NOT NULL,
  amount NUMERIC(38,6) NOT NULL CHECK (amount > 0),
  currency text COLLATE "C" NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  claimed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (provider_id,event_id)
);
CREATE TABLE protocolia_s2c_replay.audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id text COLLATE "C" NOT NULL,
  event_id text COLLATE "C" NOT NULL,
  statement_sha256 text COLLATE "C" NOT NULL,
  order_id text COLLATE "C" NOT NULL,
  transaction_id text COLLATE "C" NOT NULL,
  kind text COLLATE "C" NOT NULL,
  amount_text text COLLATE "C" NOT NULL,
  currency text COLLATE "C" NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (provider_id,event_id),
  FOREIGN KEY (provider_id,event_id)
    REFERENCES protocolia_s2c_replay.claim(provider_id,event_id) ON DELETE RESTRICT
);
CREATE FUNCTION protocolia_s2c_replay.reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $guard$
BEGIN
  RAISE EXCEPTION 'S2c replay evidence is append-only' USING ERRCODE='23514';
END $guard$;
CREATE TRIGGER claim_no_mutation BEFORE UPDATE OR DELETE
  ON protocolia_s2c_replay.claim FOR EACH ROW
  EXECUTE FUNCTION protocolia_s2c_replay.reject_mutation();
CREATE TRIGGER claim_no_truncate BEFORE TRUNCATE
  ON protocolia_s2c_replay.claim FOR EACH STATEMENT
  EXECUTE FUNCTION protocolia_s2c_replay.reject_mutation();
CREATE TRIGGER audit_no_mutation BEFORE UPDATE OR DELETE
  ON protocolia_s2c_replay.audit FOR EACH ROW
  EXECUTE FUNCTION protocolia_s2c_replay.reject_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE
  ON protocolia_s2c_replay.audit FOR EACH STATEMENT
  EXECUTE FUNCTION protocolia_s2c_replay.reject_mutation();

-- Caller must authenticate and verify the signed statement BEFORE invoking.
-- SECURITY DEFINER executes as the dedicated NOLOGIN owner. Runtime gets
-- EXECUTE only; no table, sequence, DDL or trigger privileges. A fixed
-- search_path (pg_temp last) prevents caller-controlled name shadowing.
-- This is an isolated SQL contract proof, not a wired application entrypoint.
CREATE FUNCTION protocolia_s2c_replay.claim_verified_batch(
  v_provider text,v_order text,v_statement_sha256 text,v_events jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, protocolia_s2c_replay, pg_temp AS $claim$
DECLARE
  item jsonb;
  v_event text;
  v_transaction text;
  v_kind text;
  v_amount text;
  v_currency text;
  inserted integer := 0;
BEGIN
  IF v_provider IS NULL OR v_provider !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR v_order IS NULL OR v_order !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR v_statement_sha256 IS NULL OR v_statement_sha256 !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(v_events) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid signed event batch metadata' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(v_events) NOT BETWEEN 1 AND 512
  THEN RAISE EXCEPTION 'Invalid signed event batch size' USING ERRCODE='23514'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(v_events) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR
       (SELECT count(*) FROM jsonb_object_keys(item)) <> 6 OR
       jsonb_typeof(item->'providerId') IS DISTINCT FROM 'string' OR
       jsonb_typeof(item->'eventId') IS DISTINCT FROM 'string' OR
       jsonb_typeof(item->'transactionId') IS DISTINCT FROM 'string' OR
       jsonb_typeof(item->'kind') IS DISTINCT FROM 'string' OR
       jsonb_typeof(item->'amount') IS DISTINCT FROM 'string' OR
       jsonb_typeof(item->'currency') IS DISTINCT FROM 'string'
    THEN RAISE EXCEPTION 'Malformed signed event row' USING ERRCODE='23514'; END IF;
    v_event := item->>'eventId';
    v_transaction := item->>'transactionId';
    v_kind := item->>'kind';
    v_amount := item->>'amount';
    v_currency := item->>'currency';
    IF item->>'providerId' IS DISTINCT FROM v_provider OR
       v_event !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' OR
       v_transaction !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' OR
       v_kind NOT IN ('capture','refund','chargeback') OR
       v_currency !~ '^[A-Z]{3}$' OR
       v_amount !~ '^(0|[1-9][0-9]*)([.][0-9]+)?$' OR
       length(split_part(v_amount,'.',1)) > 32 OR
       length(split_part(v_amount,'.',2)) > 6 OR
       v_amount::numeric <= 0
    THEN RAISE EXCEPTION 'Invalid signed event identity or exact amount'
      USING ERRCODE='23514'; END IF;
    -- UNIQUE(provider_id,event_id) is the cross-process linearization point.
    -- A duplicate anywhere in the batch aborts ALL claims and audit rows.
    INSERT INTO claim(provider_id,event_id,order_id,statement_sha256,
      transaction_id,kind,amount_text,amount,currency)
    VALUES(v_provider,v_event,v_order,v_statement_sha256,
      v_transaction,v_kind,v_amount,v_amount::numeric,v_currency);
    INSERT INTO audit(provider_id,event_id,statement_sha256,order_id,
      transaction_id,kind,amount_text,currency)
    VALUES(v_provider,v_event,v_statement_sha256,v_order,
      v_transaction,v_kind,v_amount,v_currency);
    inserted := inserted+1;
  END LOOP;
  RETURN inserted;
END $claim$;
REVOKE ALL ON FUNCTION protocolia_s2c_replay.claim_verified_batch(text,text,text,jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION protocolia_s2c_replay.reject_mutation() FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA protocolia_s2c_replay FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA protocolia_s2c_replay FROM PUBLIC;
GRANT USAGE ON SCHEMA protocolia_s2c_replay TO protocolia_s2c_runtime;
GRANT EXECUTE ON FUNCTION protocolia_s2c_replay.claim_verified_batch(text,text,text,jsonb)
  TO protocolia_s2c_runtime;
RESET ROLE;
COMMIT;
