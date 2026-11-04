#!/usr/bin/env bash
# Real generated HTTP + PostgreSQL role-RLS proof. Disposable Compose only.
set -euo pipefail
if [[ "${PROTOCOLIA_ALLOW_DISPOSABLE_DB_TEST:-}" != "true" ]]; then
  echo "Disposable test opt-in required" >&2; exit 2
fi
if [[ "$#" -ne 2 || ! -d "$1" || ( "$2" != "nestjs" && "$2" != "modular-spring" ) ]]; then
  echo "Usage: PROTOCOLIA_ALLOW_DISPOSABLE_DB_TEST=true bash tenant-rls-runtime-e2e.sh GENERATED_APP TARGET" >&2
  exit 2
fi
out="$(realpath "$1")"
target="$2"
root="$(cd "$(dirname "$0")/../.." && pwd)"
sql="$out/protocolia-tenant-rls-role-candidate.sql"
baseline="$out/src/schema.sql"
if [[ "$target" == "modular-spring" ]]; then
  baseline="$out/src/main/resources/db/migration/V1__contract_baseline.sql"
fi
for file in "$sql" "$baseline" "$out/protocolia-build.json" "$out/compose.yaml"; do
  [[ -f "$file" ]] || { echo "Missing generated runtime proof input" >&2; exit 2; }
done
work="$(mktemp -d)"
chmod 700 "$work"
project="protocolia_rls_s1_$(openssl rand -hex 5)"
password="$(openssl rand -hex 24)"
ownerPassword="$(openssl rand -hex 24)"
alphaPassword="$(openssl rand -hex 24)"
betaPassword="$(openssl rand -hex 24)"
managerPassword="$(openssl rand -hex 24)"
readerPassword="$(openssl rand -hex 24)"
peerPassword="$(openssl rand -hex 24)"
handoff="$(openssl rand -hex 32)"
port="$(node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});')"
envFile="$work/test.env"
cat > "$envFile" <<VARS
PROTOCOLIA_DB_PASSWORD=$password
PROTOCOLIA_RUNTIME_DB_USER=protocolia_rls_alpha
PROTOCOLIA_RUNTIME_DB_PASSWORD=$alphaPassword
PROTOCOLIA_MIGRATION_DB_USER=
PROTOCOLIA_MIGRATION_DB_PASSWORD=
PROTOCOLIA_TENANT_SQL_ROUTING=alpha-beta-v1
PROTOCOLIA_TENANT_SQL_ALPHA_USER=protocolia_rls_alpha
PROTOCOLIA_TENANT_SQL_ALPHA_PASSWORD=$alphaPassword
PROTOCOLIA_TENANT_SQL_BETA_USER=protocolia_rls_beta
PROTOCOLIA_TENANT_SQL_BETA_PASSWORD=$betaPassword
PROTOCOLIA_EXECUTION_MODE=runtime
PROTOCOLIA_MIGRATION_HANDOFF_ID=$handoff
PROTOCOLIA_HOST_PORT=$port
PROTOCOLIA_ALLOW_DEMO_AUTH=true
PROTOCOLIA_READER_USERNAME=test_reader
PROTOCOLIA_READER_PASSWORD=$readerPassword
PROTOCOLIA_MANAGER_USERNAME=test_manager
PROTOCOLIA_MANAGER_PASSWORD=$managerPassword
PROTOCOLIA_SCOPED_USERNAME=test_tenant_peer
PROTOCOLIA_SCOPED_PASSWORD=$peerPassword
PROTOCOLIA_SCOPED_CAPABILITIES=serviceticket.read.tenant,serviceticket.write.tenant,serviceticket.submit,serviceticket.decide.checked
PROTOCOLIA_TEST_TENANT_MANAGER=org_alpha
PROTOCOLIA_TEST_TENANT_READER=org_alpha
PROTOCOLIA_TEST_TENANT_SCOPED=org_beta
VARS
chmod 600 "$envFile"
compose=(docker compose --project-name "$project" --env-file "$envFile" -f "$out/compose.yaml")
cleanup(){
  status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "RLS-S1 $target HTTP proof failed ($status); app logs:" >&2
    "${compose[@]}" logs --tail 75 app >&2 || true
    "${compose[@]}" logs --tail 45 db >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
admin(){
  "${compose[@]}" exec -T db psql -X -U protocolia -d protocolia -v ON_ERROR_STOP=1 -q
}
owner(){
  "${compose[@]}" exec -T -e PGPASSWORD="$ownerPassword" db \
    psql -X -h 127.0.0.1 -U protocolia_rls_owner -d protocolia -v ON_ERROR_STOP=1 -q
}
alpha(){
  "${compose[@]}" exec -T -e PGPASSWORD="$alphaPassword" db \
    psql -X -h 127.0.0.1 -U protocolia_rls_alpha -d protocolia -v ON_ERROR_STOP=1 -q
}
beta(){
  "${compose[@]}" exec -T -e PGPASSWORD="$betaPassword" db \
    psql -X -h 127.0.0.1 -U protocolia_rls_beta -d protocolia -v ON_ERROR_STOP=1 -q
}
"${compose[@]}" config --quiet
"${compose[@]}" up --detach db >/dev/null
ready=false
for _ in $(seq 1 70); do
  if "${compose[@]}" exec -T db pg_isready -q -h 127.0.0.1 -U protocolia -d protocolia; then
    ready=true; break
  fi
  sleep 1
done
[[ "$ready" == "true" ]] || { echo "Disposable DB TCP never became ready" >&2; exit 1; }
admin <<SQL
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE protocolia_rls_owner LOGIN NOINHERIT PASSWORD '$ownerPassword';
CREATE ROLE protocolia_rls_alpha LOGIN NOINHERIT PASSWORD '$alphaPassword';
CREATE ROLE protocolia_rls_beta LOGIN NOINHERIT PASSWORD '$betaPassword';
ALTER SCHEMA public OWNER TO protocolia_rls_owner;
SQL
owner < "$baseline"
{
  printf '%s\n' 'BEGIN;' \
    "SET LOCAL protocolia.rls_role_alpha='protocolia_rls_alpha';" \
    "SET LOCAL protocolia.rls_role_beta='protocolia_rls_beta';"
  cat "$sql"
  printf '%s\n' \
    "INSERT INTO public.protocolia_rls_principal_tenant(principal,tenant_id)" \
    " VALUES ('protocolia_rls_alpha','org_alpha'),('protocolia_rls_beta','org_beta');" \
    'COMMIT;'
} | owner
owner <<SQL
CREATE TABLE public.protocolia_migration_handoff_v1 (
  image_digest varchar(64) PRIMARY KEY,
  completed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.protocolia_migration_handoff_v1(image_digest) VALUES ('$handoff');
GRANT SELECT ON public.protocolia_migration_handoff_v1 TO protocolia_rls_alpha;
SQL
echo "PROTOCOLIA_TENANT_S1_OPERATOR_BOOTSTRAP_PASS $target"
"${compose[@]}" up --detach --build app >/dev/null
health=false
for _ in $(seq 1 100); do
  if curl --silent --fail --max-time 2 "http://127.0.0.1:$port/health" >/dev/null; then
    health=true;break
  fi
  sleep 1
done
[[ "$health" == "true" ]] || { echo "Generated app refused runtime startup" >&2; exit 1; }
echo "PROTOCOLIA_TENANT_S1_APP_HEALTH_PASS $target"
set -a
# File contains only random, local, shell-safe credentials emitted above.
source "$envFile"
set +a
export PROTOCOLIA_ALLOW_CONFORMANCE_WRITES=true
node "$root/packages/cli/conformance.mjs" "$out" "http://127.0.0.1:$port" \
  | tee "$work/conformance.log"
grep -q 'PROTOCOLIA_TENANT_MAKER_HTTP_CONFORMANCE_PASS' "$work/conformance.log"
grep -q 'PROTOCOLIA_MAKER_CHECKER_CONFORMANCE_PASS' "$work/conformance.log"
alpha <<'SQL'
DO $p$
DECLARE n integer;
BEGIN
  IF session_user<>'protocolia_rls_alpha' OR
     public.protocolia_rls_session_tenant()<>'org_alpha' THEN
    RAISE EXCEPTION 'Alpha session role not pinned';
  END IF;
  SELECT COUNT(*) INTO n FROM public.service_ticket;
  IF n<1 OR EXISTS(SELECT 1 FROM public.service_ticket
    WHERE protocolia_tenant_id<>'org_alpha') THEN
    RAISE EXCEPTION 'Alpha runtime SQL sees foreign organization';
  END IF;
  PERFORM set_config('protocolia.tenant','org_beta',false);
  IF EXISTS(SELECT 1 FROM public.service_ticket
    WHERE protocolia_tenant_id='org_beta') THEN
    RAISE EXCEPTION 'Alpha session GUC spoof bypassed RLS';
  END IF;
END $p$;
SQL
beta <<'SQL'
DO $p$
DECLARE n integer;
BEGIN
  IF session_user<>'protocolia_rls_beta' OR
     public.protocolia_rls_session_tenant()<>'org_beta' THEN
    RAISE EXCEPTION 'Beta session role not pinned';
  END IF;
  SELECT COUNT(*) INTO n FROM public.service_ticket;
  IF n<1 OR EXISTS(SELECT 1 FROM public.service_ticket
    WHERE protocolia_tenant_id<>'org_beta') THEN
    RAISE EXCEPTION 'Beta runtime SQL sees foreign organization';
  END IF;
END $p$;
SQL
admin <<'SQL'
DO $proof$
DECLARE n_a integer; n_b integer; events integer;
BEGIN
  SELECT COUNT(*) INTO n_a FROM public.service_ticket WHERE protocolia_tenant_id='org_alpha';
  SELECT COUNT(*) INTO n_b FROM public.service_ticket WHERE protocolia_tenant_id='org_beta';
  SELECT COUNT(*) INTO events FROM public.protocolia_audit_event;
  IF n_a<1 OR n_b<1 OR events<2 OR
     EXISTS(SELECT 1 FROM public.protocolia_audit_event
       WHERE protocolia_tenant_id NOT IN ('org_alpha','org_beta')) OR
     NOT EXISTS(SELECT 1 FROM public.protocolia_audit_event
       WHERE protocolia_tenant_id='org_alpha') OR
     NOT EXISTS(SELECT 1 FROM public.protocolia_audit_event
       WHERE protocolia_tenant_id='org_beta') THEN
    RAISE EXCEPTION 'HTTP-to-DB tenant and audit boundary failed';
  END IF;
END $proof$;
SQL
echo "PROTOCOLIA_TENANT_S1_HTTP_POSTGRES_PROOF_PASS $target"
