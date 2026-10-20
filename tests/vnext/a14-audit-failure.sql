CREATE FUNCTION protocolia_a14_test_block_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operation_name = 'reassignTicketTechnician' THEN
    RAISE EXCEPTION 'A14 injected audit journal failure';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER protocolia_a14_test_audit_failure
BEFORE INSERT ON protocolia_audit_event
FOR EACH ROW EXECUTE FUNCTION protocolia_a14_test_block_audit();
