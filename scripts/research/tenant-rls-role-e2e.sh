#!/usr/bin/env bash
# Disposable PostgreSQL 16 SQL-authority proof. NEVER accepts a production DB URL.
set -euo pipefail
if [[ "${PROTOCOLIA_ALLOW_DISPOSABLE_DB_TEST:-}" != "true" ]]; then
  echo "Explicit disposable test opt-in required" >&2; exit 2
fi
if [[ "$#" -ne 1 || ! -f "$1" ]]; then
  echo "Usage: PROTOCOLIA_ALLOW_DISPOSABLE_DB_TEST=true $0 GENERATED_CANDIDATE_SQL" >&2
  exit 2
fi
sql="$(realpath "$1")"
case "$sql" in
  *.sql) ;;
  *) echo "Candidate must have .sql extension" >&2; exit 2 ;;
esac
container="protocolia_rls_$RANDOM${RANDOM}"
password="$(openssl rand -hex 24)"
owner_pwd="$(openssl rand -hex 24)"
alpha_pwd="$(openssl rand -hex 24)"
beta_pwd="$(openssl rand -hex 24)"
outsider_pwd="$(openssl rand -hex 24)"
cleanup(){
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "RLS disposable PostgreSQL harness failed (exit $status); server diagnostics:" >&2
    docker logs --tail 60 "$container" >&2 || true
  fi
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker run --rm -d --name "$container" \
  -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=protocolia \
  postgres:16.15-alpine >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -q -U postgres -d protocolia; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -q -U postgres -d protocolia
echo "RLS_DB_CONTAINER_READY"
admin(){ docker exec -i "$container" psql -X -U postgres -d protocolia -v ON_ERROR_STOP=1 -q; }
owner(){ docker exec -i -e PGPASSWORD="$owner_pwd" "$container" \
  psql -X -h 127.0.0.1 -U protocolia_rls_owner -d protocolia -v ON_ERROR_STOP=1 -q; }
alpha(){ docker exec -i -e PGPASSWORD="$alpha_pwd" "$container" \
  psql -X -h 127.0.0.1 -U protocolia_rls_alpha -d protocolia -v ON_ERROR_STOP=1 -q; }
beta(){ docker exec -i -e PGPASSWORD="$beta_pwd" "$container" \
  psql -X -h 127.0.0.1 -U protocolia_rls_beta -d protocolia -v ON_ERROR_STOP=1 -q; }
outsider(){ docker exec -i -e PGPASSWORD="$outsider_pwd" "$container" \
  psql -X -h 127.0.0.1 -U protocolia_rls_outsider -d protocolia -v ON_ERROR_STOP=1 -q; }
admin <<SQL
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE protocolia_rls_owner LOGIN NOINHERIT PASSWORD '$owner_pwd';
CREATE ROLE protocolia_rls_alpha LOGIN NOINHERIT PASSWORD '$alpha_pwd';
CREATE ROLE protocolia_rls_beta LOGIN NOINHERIT PASSWORD '$beta_pwd';
CREATE ROLE protocolia_rls_outsider LOGIN NOINHERIT PASSWORD '$outsider_pwd';
ALTER SCHEMA public OWNER TO protocolia_rls_owner;
SQL
echo "RLS_DB_ROLES_PROVISIONED"
owner <<'SQL'
CREATE TABLE public.service_ticket (
  ticket_code varchar(65) PRIMARY KEY,
  description varchar(170) NOT NULL,
  phase varchar(32) NOT NULL DEFAULT 'reported',
  protocolia_tenant_id varchar(64) NOT NULL,
  protocolia_submitted_by varchar(128)
);
INSERT INTO public.service_ticket(ticket_code,description,phase,protocolia_tenant_id)
VALUES ('A001','alpha one','reported','org_alpha'),
       ('A002','alpha two','reported','org_alpha'),
       ('B001','beta one','reported','org_beta');
SQL
echo "RLS_DB_SEEDED"
admin <<'SQL'
CREATE ROLE protocolia_rls_shadow NOLOGIN;
GRANT protocolia_rls_shadow TO protocolia_rls_alpha;
SQL
if {
  printf "%s\n" "BEGIN;" \
    "SET LOCAL protocolia.rls_role_alpha='protocolia_rls_alpha';" \
    "SET LOCAL protocolia.rls_role_beta='protocolia_rls_beta';"
  cat "$sql"
  printf "%s\n" "COMMIT;"
} | owner >/dev/null 2>&1; then
  echo "Unexpected membership accepted" >&2
  exit 1
fi
admin <<'SQL'
REVOKE protocolia_rls_shadow FROM protocolia_rls_alpha;
DROP ROLE protocolia_rls_shadow;
SQL
echo "RLS_DB_MEMBERSHIP_REJECTED"
# Unsafe missing operator roles must fail without leaving any RLS artifacts.
if owner < "$sql" >/dev/null 2>&1; then
  echo "RLS preflight accepted missing role bindings" >&2
  exit 1
fi
owner <<'SQL'
DO $check$
BEGIN
  IF to_regclass('public.protocolia_rls_principal_tenant') IS NOT NULL OR
     (SELECT relrowsecurity FROM pg_class WHERE oid='public.service_ticket'::regclass) THEN
    RAISE EXCEPTION 'Failed preflight left partial SQL artifacts';
  END IF;
END $check$;
SQL
{
  printf "%s\n" "BEGIN;" \
    "SET LOCAL protocolia.rls_role_alpha='protocolia_rls_alpha';" \
    "SET LOCAL protocolia.rls_role_beta='protocolia_rls_beta';"
  cat "$sql"
  printf "%s\n" \
    "INSERT INTO public.protocolia_rls_principal_tenant(principal,tenant_id)" \
    " VALUES ('protocolia_rls_alpha','org_alpha'),('protocolia_rls_beta','org_beta');" \
    "COMMIT;"
} | owner
echo "RLS_DB_POLICY_ACTIVATED"
# A second application MUST reject drift/replay. It cannot weaken existing RLS.
if {
  printf "%s\n" "BEGIN;" \
    "SET LOCAL protocolia.rls_role_alpha='protocolia_rls_alpha';" \
    "SET LOCAL protocolia.rls_role_beta='protocolia_rls_beta';"
  cat "$sql"
  printf "%s\n" "COMMIT;"
} | owner >/dev/null 2>&1; then
  echo "RLS candidate unexpectedly permitted reapplication" >&2
  exit 1
fi
alpha <<'SQL'
DO $probe$
DECLARE n integer;
BEGIN
  IF current_user <> 'protocolia_rls_alpha' OR
     session_user <> 'protocolia_rls_alpha' OR
     public.protocolia_rls_session_tenant() <> 'org_alpha' THEN
    RAISE EXCEPTION 'Alpha principal is not bound to its own tenant';
  END IF;
  SELECT COUNT(*) INTO n FROM public.service_ticket;
  IF n<>2 OR EXISTS(SELECT 1 FROM public.service_ticket WHERE ticket_code='B001') THEN
    RAISE EXCEPTION 'Alpha read leaked Beta records';
  END IF;
  PERFORM set_config('protocolia.tenant','org_beta',false);
  PERFORM set_config('protocolia.rls_role_beta','protocolia_rls_beta',false);
  IF EXISTS(SELECT 1 FROM public.service_ticket WHERE ticket_code='B001') OR
     public.protocolia_rls_session_tenant()<>'org_alpha' THEN
    RAISE EXCEPTION 'Mutable settings bypassed principal-pinned RLS';
  END IF;
  UPDATE public.service_ticket SET description='forged' WHERE ticket_code='B001';
  IF FOUND THEN RAISE EXCEPTION 'Alpha updated Beta row'; END IF;
  BEGIN
    INSERT INTO public.service_ticket(ticket_code,description,phase,protocolia_tenant_id)
      VALUES ('B999','forged Beta','reported','org_beta');
    RAISE EXCEPTION 'Alpha inserted Beta row';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.service_ticket SET protocolia_tenant_id='org_beta'
      WHERE ticket_code='A001';
    RAISE EXCEPTION 'Alpha reassigned tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.service_ticket WHERE ticket_code='A001';
    RAISE EXCEPTION 'Alpha deleted business record';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE public.service_ticket;
    RAISE EXCEPTION 'Alpha truncated business table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM (SELECT COUNT(*) FROM public.protocolia_rls_principal_tenant);
    RAISE EXCEPTION 'Alpha read private principal mapping';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.protocolia_rls_principal_tenant SET tenant_id='org_beta';
    RAISE EXCEPTION 'Alpha rewrote private principal mapping';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER TABLE public.service_ticket DISABLE ROW LEVEL SECURITY';
    RAISE EXCEPTION 'Alpha disabled business RLS';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'SET ROLE protocolia_rls_beta';
    RAISE EXCEPTION 'Alpha changed to Beta database role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.service_ticket WHERE ticket_code='B001') OR
     (SELECT COUNT(*) FROM public.service_ticket)<>2 THEN
    RAISE EXCEPTION 'Alpha isolation changed after rejected mutations';
  END IF;
END $probe$;
SQL
beta <<'SQL'
DO $probe$
DECLARE n integer;
BEGIN
  IF session_user <> 'protocolia_rls_beta' OR
     public.protocolia_rls_session_tenant()<>'org_beta' THEN
    RAISE EXCEPTION 'Beta principal mapping failed';
  END IF;
  SELECT COUNT(*) INTO n FROM public.service_ticket;
  IF n<>1 OR EXISTS(SELECT 1 FROM public.service_ticket WHERE ticket_code='A001') THEN
    RAISE EXCEPTION 'Beta read leaked Alpha';
  END IF;
  PERFORM set_config('protocolia.tenant','org_alpha',false);
  IF EXISTS(SELECT 1 FROM public.service_ticket WHERE ticket_code='A002') THEN
    RAISE EXCEPTION 'Beta tenant GUC spoof changed database authority';
  END IF;
  UPDATE public.service_ticket SET description='forged' WHERE ticket_code='A001';
  IF FOUND THEN RAISE EXCEPTION 'Beta updated Alpha'; END IF;
  INSERT INTO public.service_ticket(ticket_code,description,phase,protocolia_tenant_id)
    VALUES ('B002','beta new','reported','org_beta');
  SELECT COUNT(*) INTO n FROM public.service_ticket;
  IF n<>2 THEN RAISE EXCEPTION 'Beta own-tenant INSERT was denied'; END IF;
END $probe$;
SQL
outsider <<'SQL'
DO $probe$
BEGIN
  BEGIN
    PERFORM public.protocolia_rls_session_tenant();
    RAISE EXCEPTION 'Outsider executed private tenant lookup';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM (SELECT COUNT(*) FROM public.service_ticket);
    RAISE EXCEPTION 'Outsider read protected table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $probe$;
SQL
admin <<'SQL'
DO $proof$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.service_ticket'::regclass
      AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'RLS was not enabled and forced';
  END IF;
  IF (SELECT COUNT(*) FROM public.service_ticket)<>4 OR
     (SELECT description FROM public.service_ticket WHERE ticket_code='B001')<>'beta one' OR
     (SELECT protocolia_tenant_id FROM public.service_ticket WHERE ticket_code='A001')<>'org_alpha' THEN
    RAISE EXCEPTION 'SQL adversarial test corrupted another tenant';
  END IF;
END $proof$;
SQL
echo 'PROTOCOLIA_ROLE_PINNED_RLS_DB_PROOF_PASS {"postgres":"16.15","tenants":2,"separateSqlLogins":true,"denied":["cross-read","cross-update","cross-insert","tenant-reassign","delete","truncate","mapping-read","mapping-update","rls-disable","role-impersonation","guc-spoof"],"preservedRows":4}'
