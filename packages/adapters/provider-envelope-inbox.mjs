// S2c-1c1: durable provider-envelope *inbox*, not payment settlement.
// The generator may provision this only for a canonical exact reconciliation
// that explicitly declares the fixed, unverified provider proof field.
// Signature authentication happens outside PostgreSQL; this SQL only makes
// storage and replay classification atomic. Never mark a receipt settled here.
export function providerEnvelopeInboxSql(exactReconciliations) {
  if (!(exactReconciliations instanceof Map)) throw Error("Missing canonical reconciliation plans");
  const plans=[...exactReconciliations.values()];
  if (!plans.some(plan=>plan.unverifiedProofField)) return [];
  if (plans.some(plan=>plan.unverifiedProofField &&
    (!plan.childReadCapability || typeof plan.childReadCapability!=="string")))
    throw Error("Invalid provider inbox binding");
  const ddl=[
    `CREATE TABLE protocolia_provider_envelope_inbox (
      provider_id VARCHAR(64) COLLATE "C" NOT NULL
        CHECK (provider_id ~ '^[A-Za-z0-9_-]{1,64}$'),
      event_id VARCHAR(128) COLLATE "C" NOT NULL
        CHECK (event_id ~ '^[A-Za-z0-9_-]{8,128}$'),
      payload_sha256 CHAR(64) COLLATE "C" NOT NULL
        CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
      first_received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider_id,event_id)
    );`,
    `CREATE FUNCTION protocolia_record_provider_envelope_digest(
      v_provider TEXT,v_event TEXT,v_digest TEXT
    ) RETURNS TEXT LANGUAGE plpgsql AS $provider_inbox$
    DECLARE existing_digest TEXT;
    BEGIN
      IF v_provider IS NULL OR length(v_provider) NOT BETWEEN 1 AND 64 OR
         v_provider !~ '^[A-Za-z0-9_-]+$' OR
         v_event IS NULL OR length(v_event) NOT BETWEEN 8 AND 128 OR
         v_event !~ '^[A-Za-z0-9_-]+$' OR
         v_digest IS NULL OR length(v_digest)<>64 OR
         v_digest !~ '^[0-9a-f]+$'
      THEN RAISE EXCEPTION 'Invalid provider envelope identity or digest'
        USING ERRCODE='23514'; END IF;
      INSERT INTO protocolia_provider_envelope_inbox(provider_id,event_id,payload_sha256)
        VALUES(v_provider,v_event,v_digest) ON CONFLICT DO NOTHING;
      IF FOUND THEN RETURN 'stored'; END IF;
      SELECT payload_sha256 INTO existing_digest
        FROM protocolia_provider_envelope_inbox
        WHERE provider_id=v_provider AND event_id=v_event;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider envelope concurrency retry required'
          USING ERRCODE='40001';
      END IF;
      IF existing_digest=v_digest THEN RETURN 'duplicate'; END IF;
      RETURN 'conflict';
    END $provider_inbox$;`,
    `CREATE FUNCTION protocolia_provider_envelope_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $provider_immutable$
      BEGIN RAISE EXCEPTION 'Provider envelope inbox is append-only'
        USING ERRCODE='23514'; END $provider_immutable$;`,
    `CREATE TRIGGER protocolia_provider_envelope_immutable_guard
      BEFORE UPDATE OR DELETE ON protocolia_provider_envelope_inbox
      FOR EACH ROW EXECUTE FUNCTION protocolia_provider_envelope_immutable();`
  ];
  return appendProviderCandidate(plans,ddl);
}

function appendProviderCandidate(plans,ddl){
  const bindings=plans.filter(p=>p.unverifiedProofField).map(p=>p.providerCandidate);
  if(bindings.length!==1)throw Error("Receipt candidate requires one canonical exact ledger");
  const b=bindings[0],safe=x=>typeof x==="string"&&/^[a-z][a-z0-9_]*$/.test(x);
  if(!b||![b.childTable,b.receiptColumn,b.referenceColumn,b.amountColumn,b.stateColumn,b.proofColumn].every(safe)||
    b.postedState!=="posted"||!Number.isInteger(b.precision)||!Number.isInteger(b.scale)||
    b.precision<1||b.precision>38||b.scale<0||b.scale>b.precision||
    typeof b.max!=="string"||!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(b.max))
    throw Error("Invalid canonical receipt candidate binding");
  ddl.push(
    `CREATE TABLE protocolia_provider_receipt_candidate (
      provider_id VARCHAR(64) COLLATE "C" NOT NULL,
      event_id VARCHAR(128) COLLATE "C" NOT NULL,
      receipt_id VARCHAR(255) NOT NULL REFERENCES ${b.childTable}(${b.receiptColumn}) ON DELETE RESTRICT,
      order_id VARCHAR(255) NOT NULL,
      amount NUMERIC(${b.precision},${b.scale}) NOT NULL CHECK (amount>0),
      -- A v1 receipt candidate is a one-time provider/transaction binding.
      -- Later lifecycle observations must reference this binding, not claim
      -- the same receipt through a second event or another provider.
      UNIQUE (receipt_id),
      -- Composite authority: a lifecycle row must match all immutable claims,
      -- even if someone bypasses the generated SQL function.
      UNIQUE (provider_id,event_id,receipt_id,order_id,amount),
      PRIMARY KEY(provider_id,event_id),
      FOREIGN KEY(provider_id,event_id)
        REFERENCES protocolia_provider_envelope_inbox(provider_id,event_id) ON DELETE RESTRICT
    );`,
    `CREATE FUNCTION protocolia_record_provider_receipt_candidate(
      v_provider TEXT,v_event TEXT,v_digest TEXT,v_receipt TEXT,v_order TEXT,v_amount NUMERIC
    ) RETURNS TEXT LANGUAGE plpgsql AS $receipt_candidate$
    DECLARE actual_order TEXT;actual_amount NUMERIC;actual_state TEXT;actual_proof TEXT;
      outcome TEXT;old_receipt TEXT;old_order TEXT;old_amount NUMERIC;old_digest TEXT;
      bound_provider TEXT;bound_event TEXT;
    BEGIN
      IF v_receipt IS NULL OR length(v_receipt) NOT BETWEEN 1 AND 255 OR
         v_order IS NULL OR length(v_order) NOT BETWEEN 1 AND 255 OR
         v_amount IS NULL OR v_amount<=0 OR v_amount>${b.max}::NUMERIC OR
         v_amount<>ROUND(v_amount,${b.scale})
      THEN RAISE EXCEPTION 'Invalid exact receipt candidate'
        USING ERRCODE='23514'; END IF;
      -- A committed event is an immutable historical fact. Its identical replay
      -- must remain idempotent even if the receipt was subsequently reversed.
      -- Lock the inbox row to wait for a concurrent first delivery to commit.
      -- An unbound digest-only envelope must NEVER gain receipt authority.
      SELECT payload_sha256 INTO old_digest
        FROM protocolia_provider_envelope_inbox
        WHERE provider_id=v_provider AND event_id=v_event FOR UPDATE;
      IF FOUND THEN
        IF old_digest IS DISTINCT FROM v_digest THEN RETURN 'conflict'; END IF;
        SELECT receipt_id,order_id,amount INTO old_receipt,old_order,old_amount
          FROM protocolia_provider_receipt_candidate
          WHERE provider_id=v_provider AND event_id=v_event;
        IF NOT FOUND THEN RETURN 'conflict'; END IF;
        IF old_receipt=v_receipt AND old_order=v_order AND old_amount=v_amount
        THEN RETURN 'duplicate'; END IF;
        RETURN 'conflict';
      END IF;
      SELECT p.${b.referenceColumn},p.${b.amountColumn},p.${b.stateColumn},p.${b.proofColumn}
        INTO actual_order,actual_amount,actual_state,actual_proof
        FROM ${b.childTable} p WHERE p.${b.receiptColumn}=v_receipt FOR UPDATE;
      IF NOT FOUND THEN RETURN 'missing'; END IF;
      -- A concurrent first delivery can commit while we wait for the receipt
      -- row lock. Recheck the immutable event after acquiring that lock:
      -- same event -> duplicate, different event -> single-owner conflict.
      -- This also preserves deterministic replay if status changed meanwhile.
      SELECT payload_sha256 INTO old_digest
        FROM protocolia_provider_envelope_inbox
        WHERE provider_id=v_provider AND event_id=v_event FOR UPDATE;
      IF FOUND THEN
        IF old_digest IS DISTINCT FROM v_digest THEN RETURN 'conflict'; END IF;
        SELECT receipt_id,order_id,amount INTO old_receipt,old_order,old_amount
          FROM protocolia_provider_receipt_candidate
          WHERE provider_id=v_provider AND event_id=v_event;
        IF NOT FOUND THEN RETURN 'conflict'; END IF;
        IF old_receipt=v_receipt AND old_order=v_order AND old_amount=v_amount
        THEN RETURN 'duplicate'; END IF;
        RETURN 'conflict';
      END IF;
      IF actual_order<>v_order OR actual_amount<>v_amount OR
         actual_state<>'posted' OR actual_proof<>'unverified'
      THEN RETURN 'mismatch'; END IF;
      -- Receipt row lock serializes different event IDs and providers trying
      -- to claim the same receipt. Reject before inserting any inbox envelope.
      -- UNIQUE(receipt_id) remains the database backstop against bypass.
      SELECT provider_id,event_id INTO bound_provider,bound_event
        FROM protocolia_provider_receipt_candidate
        WHERE receipt_id=v_receipt;
      IF FOUND THEN RETURN 'conflict'; END IF;
      SELECT protocolia_record_provider_envelope_digest(v_provider,v_event,v_digest)
        INTO outcome;
      IF outcome='conflict' THEN RETURN 'conflict'; END IF;
      IF outcome='stored' THEN
        INSERT INTO protocolia_provider_receipt_candidate
          (provider_id,event_id,receipt_id,order_id,amount)
          VALUES(v_provider,v_event,v_receipt,v_order,v_amount);
        RETURN 'stored';
      END IF;
      SELECT receipt_id,order_id,amount INTO old_receipt,old_order,old_amount
        FROM protocolia_provider_receipt_candidate
        WHERE provider_id=v_provider AND event_id=v_event;
      IF NOT FOUND THEN RETURN 'conflict'; END IF;
      IF old_receipt=v_receipt AND old_order=v_order AND old_amount=v_amount
      THEN RETURN 'duplicate'; END IF;
      RETURN 'conflict';
    END $receipt_candidate$;`,
    `CREATE TRIGGER protocolia_provider_receipt_candidate_immutable_guard
      BEFORE UPDATE OR DELETE ON protocolia_provider_receipt_candidate
      FOR EACH ROW EXECUTE FUNCTION protocolia_provider_envelope_immutable();`
  );

  // S2c-1c4b: append-only, *non-authoritative* synthetic lifecycle signals.
  // This is a sequencing inbox, NOT a settlement projection or payment state.
  // Out-of-order sequences may be stored but never applied to the ledger.
  ddl.push(
    `CREATE TABLE protocolia_provider_lifecycle_observation (
      provider_id VARCHAR(64) COLLATE "C" NOT NULL,
      event_id VARCHAR(128) COLLATE "C" NOT NULL,
      candidate_event_id VARCHAR(128) COLLATE "C" NOT NULL,
      receipt_id VARCHAR(255) NOT NULL,
      order_id VARCHAR(255) NOT NULL,
      amount NUMERIC(${b.precision},${b.scale}) NOT NULL CHECK (amount>0),
      event_sequence BIGINT NOT NULL CHECK (event_sequence BETWEEN 1 AND 2147483647),
      reported_phase VARCHAR(32) COLLATE "C" NOT NULL CHECK
        (reported_phase IN ('reported_pending','reported_success',
          'reported_failure','reported_reversal')),
      observed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider_id,event_id),
      UNIQUE (receipt_id,event_sequence),
      FOREIGN KEY (provider_id,event_id)
        REFERENCES protocolia_provider_envelope_inbox(provider_id,event_id) ON DELETE RESTRICT,
      FOREIGN KEY (provider_id,candidate_event_id,receipt_id,order_id,amount)
        REFERENCES protocolia_provider_receipt_candidate
          (provider_id,event_id,receipt_id,order_id,amount) ON DELETE RESTRICT
    );`,
    `CREATE FUNCTION protocolia_record_provider_lifecycle_observation(
      v_provider TEXT,v_event TEXT,v_digest TEXT,v_candidate_event TEXT,
      v_receipt TEXT,v_order TEXT,v_amount NUMERIC,v_sequence NUMERIC,v_phase TEXT
    ) RETURNS TEXT LANGUAGE plpgsql AS $lifecycle_observation$
    DECLARE old_digest TEXT;old_candidate TEXT;old_receipt TEXT;old_order TEXT;
      old_amount NUMERIC;old_sequence BIGINT;old_phase TEXT;
      actual_order TEXT;actual_amount NUMERIC;actual_state TEXT;
      seq_event TEXT;outcome TEXT;
    BEGIN
      IF v_provider IS NULL OR length(v_provider) NOT BETWEEN 1 AND 64 OR
         v_provider !~ '^[A-Za-z0-9_-]+$' OR
         v_event IS NULL OR length(v_event) NOT BETWEEN 8 AND 128 OR
         v_event !~ '^[A-Za-z0-9_-]+$' OR
         v_candidate_event IS NULL OR length(v_candidate_event) NOT BETWEEN 8 AND 128 OR
         v_candidate_event !~ '^[A-Za-z0-9_-]+$' OR
         v_event=v_candidate_event OR
         v_digest IS NULL OR v_digest !~ '^[0-9a-f]{64}$' OR
         v_receipt IS NULL OR length(v_receipt) NOT BETWEEN 1 AND 255 OR
         v_order IS NULL OR length(v_order) NOT BETWEEN 1 AND 255 OR
         v_amount IS NULL OR v_amount<=0 OR v_amount>${b.max}::NUMERIC OR
         v_amount<>ROUND(v_amount,${b.scale}) OR
         v_sequence IS NULL OR v_sequence NOT BETWEEN 1 AND 2147483647 OR
         v_sequence<>TRUNC(v_sequence) OR
         v_phase IS NULL OR v_phase NOT IN
           ('reported_pending','reported_success','reported_failure','reported_reversal')
      THEN RAISE EXCEPTION 'Invalid synthetic lifecycle observation'
        USING ERRCODE='23514'; END IF;
      -- Committed replay wins over mutable receipt status or newer observations.
      -- An envelope used by another endpoint cannot be promoted to lifecycle.
      SELECT payload_sha256 INTO old_digest
        FROM protocolia_provider_envelope_inbox
        WHERE provider_id=v_provider AND event_id=v_event FOR UPDATE;
      IF FOUND THEN
        IF old_digest IS DISTINCT FROM v_digest THEN RETURN 'conflict'; END IF;
        SELECT candidate_event_id,receipt_id,order_id,amount,event_sequence,reported_phase
          INTO old_candidate,old_receipt,old_order,old_amount,old_sequence,old_phase
          FROM protocolia_provider_lifecycle_observation
          WHERE provider_id=v_provider AND event_id=v_event;
        IF NOT FOUND THEN RETURN 'conflict'; END IF;
        IF old_candidate=v_candidate_event AND old_receipt=v_receipt AND
           old_order=v_order AND old_amount=v_amount AND
           old_sequence=v_sequence AND old_phase=v_phase
        THEN RETURN 'duplicate'; END IF;
        RETURN 'conflict';
      END IF;
      -- Serialize all new observations on the immutable candidate. This locks
      -- the sequence namespace even when events arrive in reverse order.
      SELECT order_id,amount INTO actual_order,actual_amount
        FROM protocolia_provider_receipt_candidate
        WHERE provider_id=v_provider AND event_id=v_candidate_event AND
          receipt_id=v_receipt FOR UPDATE;
      IF NOT FOUND THEN RETURN 'missing'; END IF;
      IF actual_order<>v_order OR actual_amount<>v_amount
      THEN RETURN 'mismatch'; END IF;
      SELECT ${"p."+b.stateColumn} INTO actual_state FROM ${b.childTable} p
        WHERE p.${b.receiptColumn}=v_receipt FOR UPDATE;
      IF NOT FOUND OR actual_state<>'posted' THEN RETURN 'mismatch'; END IF;
      -- The same event may have committed while we waited on the candidate.
      SELECT payload_sha256 INTO old_digest
        FROM protocolia_provider_envelope_inbox
        WHERE provider_id=v_provider AND event_id=v_event FOR UPDATE;
      IF FOUND THEN
        IF old_digest IS DISTINCT FROM v_digest THEN RETURN 'conflict'; END IF;
        SELECT candidate_event_id,receipt_id,order_id,amount,event_sequence,reported_phase
          INTO old_candidate,old_receipt,old_order,old_amount,old_sequence,old_phase
          FROM protocolia_provider_lifecycle_observation
          WHERE provider_id=v_provider AND event_id=v_event;
        IF NOT FOUND THEN RETURN 'conflict'; END IF;
        IF old_candidate=v_candidate_event AND old_receipt=v_receipt AND
           old_order=v_order AND old_amount=v_amount AND
           old_sequence=v_sequence AND old_phase=v_phase
        THEN RETURN 'duplicate'; END IF;
        RETURN 'conflict';
      END IF;
      SELECT event_id INTO seq_event FROM protocolia_provider_lifecycle_observation
        WHERE receipt_id=v_receipt AND event_sequence=v_sequence;
      IF FOUND THEN RETURN 'conflict'; END IF;
      SELECT protocolia_record_provider_envelope_digest(v_provider,v_event,v_digest)
        INTO outcome;
      IF outcome<>'stored' THEN RETURN 'conflict'; END IF;
      INSERT INTO protocolia_provider_lifecycle_observation
        (provider_id,event_id,candidate_event_id,receipt_id,order_id,amount,
          event_sequence,reported_phase)
        VALUES(v_provider,v_event,v_candidate_event,v_receipt,v_order,v_amount,
          v_sequence,v_phase);
      RETURN 'stored';
    END $lifecycle_observation$;`,
    `CREATE TRIGGER protocolia_provider_lifecycle_observation_immutable_guard
      BEFORE UPDATE OR DELETE ON protocolia_provider_lifecycle_observation
      FOR EACH ROW EXECUTE FUNCTION protocolia_provider_envelope_immutable();`,
    // S2c-1c4d: single-snapshot, read-only causal diagnostic. A coherent
    // synthetic report stream is NEVER bank-cleared settlement authority.
    `CREATE FUNCTION protocolia_provider_lifecycle_causal_projection(v_receipt TEXT)
      RETURNS TABLE(causal_integrity TEXT,last_coherent_phase TEXT,observation_count BIGINT)
      LANGUAGE SQL STABLE AS $causal_projection$
      WITH ordered AS (
        SELECT event_sequence,reported_phase,
          ROW_NUMBER() OVER (ORDER BY event_sequence) AS expected_sequence,
          LAG(reported_phase) OVER (ORDER BY event_sequence) AS previous_phase
        FROM protocolia_provider_lifecycle_observation
        WHERE receipt_id=v_receipt
      ), evaluated AS (
        SELECT COUNT(*)::BIGINT AS n,
          COALESCE(BOOL_OR(event_sequence<>expected_sequence),FALSE) AS has_gap,
          COALESCE(BOOL_OR(CASE
            WHEN previous_phase IS NULL THEN reported_phase<>'reported_pending'
            WHEN previous_phase='reported_pending' THEN
              reported_phase NOT IN ('reported_pending','reported_success','reported_failure')
            WHEN previous_phase='reported_success' THEN
              reported_phase NOT IN ('reported_success','reported_reversal')
            WHEN previous_phase='reported_failure' THEN reported_phase<>'reported_failure'
            WHEN previous_phase='reported_reversal' THEN reported_phase<>'reported_reversal'
            ELSE TRUE END),FALSE) AS invalid_transition,
          (ARRAY_AGG(reported_phase ORDER BY event_sequence DESC))[1] AS latest
        FROM ordered
      )
      SELECT (CASE WHEN n=0 THEN 'unobserved'
        WHEN has_gap THEN 'gap'
        WHEN invalid_transition THEN 'contradictory'
        ELSE 'coherent' END)::TEXT,
        (CASE WHEN n>0 AND NOT has_gap AND NOT invalid_transition
          THEN latest ELSE NULL END)::TEXT,
        n
      FROM evaluated;
    $causal_projection$;`,
    // S2c-1c4h: one MVCC snapshot of INTERNAL receipt/candidate integrity
    // and the synthetic causal report stream. Every result is non-authoritative;
    // even 'synthetic_only' is NEVER bank-cleared settlement evidence.
    `CREATE FUNCTION protocolia_provider_receipt_integrity_projection(v_receipt TEXT)
      RETURNS TABLE(internal_integrity TEXT,causal_integrity TEXT,
        last_coherent_phase TEXT,observation_count BIGINT)
      LANGUAGE SQL STABLE AS $receipt_integrity$
      WITH receipt AS (
        SELECT p.${b.receiptColumn} AS receipt_id,
          p.${b.referenceColumn} AS order_id,
          p.${b.amountColumn} AS amount,
          p.${b.stateColumn} AS receipt_state,
          p.${b.proofColumn} AS proof_state
        FROM ${b.childTable} p WHERE p.${b.receiptColumn}=v_receipt
      ), binding AS (
        SELECT c.receipt_id,c.order_id,c.amount
        FROM protocolia_provider_receipt_candidate c
        WHERE c.receipt_id=v_receipt
      )
      SELECT (CASE
        WHEN r.receipt_id IS NULL THEN 'missing'
        WHEN c.receipt_id IS NULL THEN 'unbound'
        WHEN c.order_id IS DISTINCT FROM r.order_id OR
          c.amount IS DISTINCT FROM r.amount THEN 'claim_mismatch'
        WHEN r.receipt_state IS DISTINCT FROM 'posted' THEN 'not_posted'
        WHEN r.proof_state IS DISTINCT FROM 'unverified' THEN 'proof_changed'
        WHEN projection.causal_integrity='unobserved' THEN 'no_lifecycle'
        WHEN projection.causal_integrity='gap' THEN 'causal_gap'
        WHEN projection.causal_integrity='contradictory' THEN 'causal_contradictory'
        WHEN projection.causal_integrity='coherent' THEN 'synthetic_only'
        ELSE 'causal_unknown' END)::TEXT,
        projection.causal_integrity,projection.last_coherent_phase,
        projection.observation_count
      FROM (SELECT 1) anchor
      LEFT JOIN receipt r ON TRUE
      LEFT JOIN binding c ON TRUE
      CROSS JOIN LATERAL protocolia_provider_lifecycle_causal_projection(v_receipt) projection;
    $receipt_integrity$;`
  );
  return ddl;
}
