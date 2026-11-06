#!/usr/bin/env bash
# P2 S2/0: verify authenticated PostgreSQL human role vs spoofed subject GUC.
# Local disposable PostgreSQL 16 ONLY. No published DB ports or persistent data.
set -euo pipefail
if [[ "${PROTOCOLIA_ALLOW_DISPOSABLE_DB_TEST:-}" != "true" ]]; then
  echo "Disposable SQL test opt-in required" >&2;exit 2
fi
if [[ "$#" -ne 3 || ! -f "$1" || ! -f "$2" || ! -f "$3" ]]; then
  echo "Usage: subject-role-guard-e2e.sh BASELINE_SQL S1_RLS_SQL S2_SUBJECT_SQL" >&2
  exit 2
fi
baseline="$(realpath "$1")"
s1="$(realpath "$2")"
s2="$(realpath "$3")"
container="protocolia_subject_$(openssl rand -hex 5)"
dbpwd="$(openssl rand -hex 24)"
ownerpwd="$(openssl rand -hex 24)"
apwd="$(openssl rand -hex 24)"
bpwd="$(openssl rand -hex 24)"
acpwd="$(openssl rand -hex 24)"
bcpwd="$(openssl rand -hex 24)"
cleanup(){
  code=$?
  if [[ "$code" != "0" ]]; then
    echo "S2 PostgreSQL identity proof failed: server diagnostics" >&2
    docker logs --tail 55 "$container" >&2 || true
  fi
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker run --rm --detach --name "$container" -e POSTGRES_DB=protocolia \
  -e POSTGRES_PASSWORD="$dbpwd" postgres:16.15-alpine >/dev/null
ready=false
for _ in $(seq 1 75); do
  if docker exec "$container" pg_isready -q -h 127.0.0.1 -U postgres -d protocolia; then
    ready=true;break
  fi
  sleep 1
done
[[ "$ready" == "true" ]] || { echo "Postgres TCP did not become ready" >&2;exit 1; }
admin(){ docker exec -i "$container" psql -X -U postgres -d protocolia -v ON_ERROR_STOP=1 -q; }
owner(){ docker exec -i -e PGPASSWORD="$ownerpwd" "$container" \
  psql -X -h 127.0.0.1 -U protocolia_rls_owner -d protocolia -v ON_ERROR_STOP=1 -q; }
alpha(){ docker exec -i -e PGPASSWORD="$apwd" "$container" \
  psql -X -h 127.0.0.1 -U protocolia_rls_alpha -d protocolia -v ON_ERROR_STOP=1 -q; }
beta(){ docker exec -i -e PGPASSWORD="$bpwd" "$container" \
  psql -X -h 127.0.0.1 -U protocolia_rls_beta -d protocolia -v ON_ERROR_STOP=1 -q; }
alpha_checker(){ docker exec -i -e PGPASSWORD="$acpwd" "$container" \
  psql -X -h 127.0.0.1 -U protocolia_s2_alpha_checker -d protocolia -v ON_ERROR_STOP=1 -q; }
beta_checker(){ docker exec -i -e PGPASSWORD="$bcpwd" "$container" \
  psql -X -h 127.0.0.1 -U protocolia_s2_beta_checker -d protocolia -v ON_ERROR_STOP=1 -q; }
admin <<SQL
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE protocolia_rls_owner LOGIN NOINHERIT PASSWORD '$ownerpwd';
CREATE ROLE protocolia_rls_alpha LOGIN NOINHERIT PASSWORD '$apwd';
CREATE ROLE protocolia_rls_beta LOGIN NOINHERIT PASSWORD '$bpwd';
ALTER SCHEMA public OWNER TO protocolia_rls_owner;
SQL
owner < "$baseline"
{
  printf '%s\n' "BEGIN;" \
    "SET LOCAL protocolia.rls_role_alpha='protocolia_rls_alpha';" \
    "SET LOCAL protocolia.rls_role_beta='protocolia_rls_beta';"
  cat "$s1"
  printf '%s\n' \
    "INSERT INTO public.protocolia_rls_principal_tenant(principal,tenant_id)" \
    "VALUES ('protocolia_rls_alpha','org_alpha'),('protocolia_rls_beta','org_beta');" \
    "COMMIT;"
} | owner
# S2 requires two *additional* checker LOGIN principals and must not silently
# activate with just the S1 tenant connections.
if {
  printf '%s\n' 'BEGIN;' \
    "SET LOCAL protocolia.s2_alpha_checker='protocolia_s2_alpha_checker';" \
    "SET LOCAL protocolia.s2_beta_checker='protocolia_s2_beta_checker';" \
    "SET LOCAL protocolia.s2_alpha_maker_subject='alpha-maker';" \
    "SET LOCAL protocolia.s2_alpha_checker_subject='alpha-checker';" \
    "SET LOCAL protocolia.s2_beta_maker_subject='beta-maker';" \
    "SET LOCAL protocolia.s2_beta_checker_subject='beta-checker';"
  cat "$s2"
  printf '%s\n' 'COMMIT;'
} | owner >/dev/null 2>&1; then
  echo "S2 unexpectedly accepted missing independent SQL checker principals" >&2
  exit 1
fi
admin <<SQL
CREATE ROLE protocolia_s2_alpha_checker LOGIN NOINHERIT PASSWORD '$acpwd';
CREATE ROLE protocolia_s2_beta_checker LOGIN NOINHERIT PASSWORD '$bcpwd';
SQL
{
  printf '%s\n' 'BEGIN;' \
    "SET LOCAL protocolia.s2_alpha_checker='protocolia_s2_alpha_checker';" \
    "SET LOCAL protocolia.s2_beta_checker='protocolia_s2_beta_checker';" \
    "SET LOCAL protocolia.s2_alpha_maker_subject='alpha-maker';" \
    "SET LOCAL protocolia.s2_alpha_checker_subject='alpha-checker';" \
    "SET LOCAL protocolia.s2_beta_maker_subject='beta-maker';" \
    "SET LOCAL protocolia.s2_beta_checker_subject='beta-checker';"
  cat "$s2"
  printf '%s\n' 'COMMIT;'
} | owner
echo 'PROTOCOLIA_S2_HUMAN_SQL_GUARD_ACTIVATED'
alpha <<'SQL'
DO $proof$
DECLARE s text;
BEGIN
  IF session_user<>'protocolia_rls_alpha' OR
     public.protocolia_s2_session_subject()<>'alpha-maker' THEN
    RAISE EXCEPTION 'Alpha maker role-to-person binding failed';
  END IF;
  INSERT INTO public.service_ticket(ticket_code,description,phase,protocolia_tenant_id)
   VALUES ('A001','alpha first','reported','org_alpha'),
          ('A002','alpha second','reported','org_alpha');
  -- Existing S1 maker trigger trusts this GUC. S2 must reject forged caller.
  BEGIN
    PERFORM set_config('protocolia.subject','alpha-checker',true);
    UPDATE public.service_ticket SET phase='triaged',
      protocolia_submitted_by='alpha-checker' WHERE ticket_code='A002';
    RAISE EXCEPTION 'FORGED_MAKER_GUC_WAS_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM set_config('protocolia.subject','alpha-maker',true);
  UPDATE public.service_ticket SET phase='triaged',
    protocolia_submitted_by='alpha-maker' WHERE ticket_code='A001';
  -- Forging the checker GUC makes the legacy trigger accept a self-decision,
  -- but the new SQL-login-bound trigger must reject it.
  BEGIN
    PERFORM set_config('protocolia.subject','alpha-checker',true);
    UPDATE public.service_ticket SET phase='completed' WHERE ticket_code='A001';
    RAISE EXCEPTION 'FORGED_CHECKER_GUC_WAS_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT phase FROM public.service_ticket WHERE ticket_code='A001')<>'triaged' OR
     (SELECT phase FROM public.service_ticket WHERE ticket_code='A002')<>'reported' THEN
    RAISE EXCEPTION 'S2 forged maker/checker corrupted business state';
  END IF;
  BEGIN
    INSERT INTO public.protocolia_audit_event
      (actor,entity_name,resource_id,operation_name,field_name)
      VALUES ('alpha-checker','ServiceTicket','A001','triage','phase');
    RAISE EXCEPTION 'FORGED_AUDIT_ACTOR_WAS_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.protocolia_audit_event
    (actor,entity_name,resource_id,operation_name,field_name)
    VALUES ('alpha-maker','ServiceTicket','A001','triage','phase');
  BEGIN
    PERFORM (SELECT count(*) FROM public.protocolia_s2_principal_subject);
    RAISE EXCEPTION 'S2 private mapping readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.protocolia_s2_principal_subject SET subject='alpha-checker';
    RAISE EXCEPTION 'S2 private mapping editable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'SET ROLE protocolia_s2_alpha_checker';
    RAISE EXCEPTION 'S2 checker SQL impersonation permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $proof$;
SQL
alpha_checker <<'SQL'
DO $proof$
BEGIN
  IF session_user<>'protocolia_s2_alpha_checker' OR
     public.protocolia_s2_session_subject()<>'alpha-checker' OR
     public.protocolia_rls_session_tenant()<>'org_alpha' THEN
    RAISE EXCEPTION 'Alpha checker identity/tenant binding failed';
  END IF;
  PERFORM set_config('protocolia.subject','alpha-checker',true);
  UPDATE public.service_ticket SET phase='completed' WHERE ticket_code='A001';
  IF NOT FOUND THEN RAISE EXCEPTION 'Independent checker could not approve Alpha'; END IF;
  INSERT INTO public.protocolia_audit_event
    (actor,entity_name,resource_id,operation_name,field_name)
    VALUES ('alpha-checker','ServiceTicket','A001','complete','phase');
  IF EXISTS (SELECT 1 FROM public.service_ticket WHERE protocolia_tenant_id='org_beta') THEN
    RAISE EXCEPTION 'Alpha checker read cross-tenant rows';
  END IF;
END $proof$;
SQL
beta <<'SQL'
DO $proof$
BEGIN
  INSERT INTO public.service_ticket(ticket_code,description,phase,protocolia_tenant_id)
    VALUES ('B001','beta first','reported','org_beta');
  PERFORM set_config('protocolia.subject','beta-maker',true);
  UPDATE public.service_ticket SET phase='triaged',protocolia_submitted_by='beta-maker'
    WHERE ticket_code='B001';
  IF EXISTS (SELECT 1 FROM public.service_ticket WHERE ticket_code='A001') THEN
    RAISE EXCEPTION 'Beta maker read Alpha row';
  END IF;
END $proof$;
SQL
beta_checker <<'SQL'
DO $proof$
BEGIN
  IF public.protocolia_s2_session_subject()<>'beta-checker' THEN
    RAISE EXCEPTION 'Beta checker SQL human mapping failed';
  END IF;
  PERFORM set_config('protocolia.subject','beta-checker',true);
  UPDATE public.service_ticket SET phase='dismissed' WHERE ticket_code='B001';
  IF NOT FOUND THEN RAISE EXCEPTION 'Beta independent checker was denied'; END IF;
  INSERT INTO public.service_ticket(ticket_code,description,phase,protocolia_tenant_id)
    VALUES ('B002','beta checker makes','reported','org_beta');
  UPDATE public.service_ticket SET phase='triaged',
    protocolia_submitted_by='beta-checker' WHERE ticket_code='B002';
  BEGIN
    PERFORM set_config('protocolia.subject','beta-maker',true);
    UPDATE public.service_ticket SET phase='completed' WHERE ticket_code='B002';
    RAISE EXCEPTION 'BETA_SELF_APPROVAL_GUC_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT phase FROM public.service_ticket WHERE ticket_code='B002')<>'triaged' THEN
    RAISE EXCEPTION 'Self approval changed Beta record';
  END IF;
  INSERT INTO public.protocolia_audit_event
    (actor,entity_name,resource_id,operation_name,field_name)
    VALUES ('beta-checker','ServiceTicket','B001','dismiss','phase');
END $proof$;
SQL
admin <<'SQL'
DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.service_ticket)<>4 OR
    (SELECT count(*) FROM public.service_ticket WHERE phase='completed')<>1 OR
    (SELECT count(*) FROM public.service_ticket WHERE phase='dismissed')<>1 OR
    (SELECT count(*) FROM public.service_ticket WHERE phase='triaged')<>1 OR
    (SELECT count(*) FROM public.protocolia_audit_event)<>3 OR
    (SELECT count(DISTINCT protocolia_tenant_id) FROM public.protocolia_audit_event)<>2 OR
    (SELECT count(*) FROM public.protocolia_s2_principal_subject)<>4 THEN
      RAISE EXCEPTION 'S2 final human/maker/audit database integrity invalid';
  END IF;
END $verify$;
SQL
# Revoke a human without changing the authenticated PostgreSQL LOGIN.
# The RLS policy must hide preexisting rows and deny new rows on the next
# statement; a cached live SQL session must never be a permanent capability.
owner <<'SQL'
UPDATE public.protocolia_s2_principal_subject
SET active=FALSE
WHERE principal='protocolia_s2_alpha_checker' AND tenant_id='org_alpha';
SQL
alpha_checker <<'SQL'
DO $revoked$
BEGIN
  IF public.protocolia_s2_session_subject() IS NOT NULL OR
     (SELECT count(*) FROM public.service_ticket)<>0 THEN
    RAISE EXCEPTION 'S2 revoked human can still read tenant business rows';
  END IF;
  BEGIN
    INSERT INTO public.service_ticket(ticket_code,description,phase,protocolia_tenant_id)
      VALUES ('DISABLED','not allowed','reported','org_alpha');
    RAISE EXCEPTION 'S2 revoked human can still write business rows';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.protocolia_audit_event
      (actor,entity_name,resource_id,operation_name,field_name)
      VALUES ('alpha-checker','ServiceTicket','DISABLED','revoked','phase');
    RAISE EXCEPTION 'S2 revoked human can still append audit rows';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
END $revoked$;
SQL
beta_checker <<'SQL'
DO $healthy$
BEGIN
  IF public.protocolia_s2_session_subject()<>'beta-checker' OR
     (SELECT count(*) FROM public.service_ticket)<>2 THEN
    RAISE EXCEPTION 'S2 unrelated active human was incorrectly revoked';
  END IF;
END $healthy$;
SQL
owner <<'SQL'
UPDATE public.protocolia_s2_principal_subject
SET active=TRUE
WHERE principal='protocolia_s2_alpha_checker' AND tenant_id='org_alpha';
SQL
alpha_checker <<'SQL'
DO $reactivated$
BEGIN
  IF public.protocolia_s2_session_subject()<>'alpha-checker' OR
     (SELECT count(*) FROM public.service_ticket)<>2 THEN
    RAISE EXCEPTION 'Owner reactivation failed';
  END IF;
END $reactivated$;
SQL
echo 'PROTOCOLIA_S2_LIVE_HUMAN_DB_REVOCATION_PASS'
echo 'PROTOCOLIA_S2_ROLE_PINNED_HUMAN_DB_PROOF_PASS {"tenants":2,"sqlLoginSubjects":4,"independentAlphaChecker":true,"independentBetaChecker":true,"forgedMakerGucDenied":true,"forgedCheckerGucDenied":true,"selfApprovalDenied":true,"auditActorSpoofDenied":true,"humanMappingPrivate":true}'
