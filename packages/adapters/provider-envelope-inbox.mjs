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
  return [
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
}
