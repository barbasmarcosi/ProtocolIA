#!/usr/bin/env bash
# Execute the FULL A14 contract-to-product test battery without GitHub Actions.
# Run from the repository root inside GitHub Codespaces. No extra remote account.
set -Eeuo pipefail
cd "$(git rev-parse --show-toplevel)"
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo 'BLOCKED: Docker daemon not accessible. Check Codespaces Docker feature.' >&2
  exit 2
fi
if ! command -v git >/dev/null 2>&1; then
  echo 'BLOCKED: git unavailable.' >&2; exit 2
fi
branch="$(git branch --show-current)"
if [[ "$branch" != feature/vnext-a0-typespec-jhipster-spike && "$branch" != feature/vnext-a3-nest-relations-a5-evolution ]]; then
  echo "BLOCKED: wrong branch ($branch). Run on the ProtocolIA vNext PR #52 branch." >&2
  exit 2
fi
revision="$(git rev-parse HEAD)"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo 'BLOCKED: tracked changes are dirty. Commit/stash first for reproducible evidence.' >&2
  exit 2
fi
evidence=".protocolia-evidence/codespaces"
mkdir -p "$evidence"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_id="$stamp-${revision:0:12}"
log="$evidence/$run_id.build.log"
report="$evidence/$run_id.result.json"
image_tag="protocolia-a14-codespaces:${revision:0:12}"
printf 'ProtocolIA A14: building and running all acceptance gates on %s\n' "$revision"
printf 'No GitHub Actions, Render, or external PostgreSQL will be used.\n'
printf 'Evidence: %s / %s\n' "$log" "$report"
# Keep the full non-secret build/test trace even on failure, without suppressing
# docker build's exit code behind tee. Never fabricate PASS from log markers.
set +e
docker build --progress=plain --file Dockerfile.codespaces-a14 --tag "$image_tag" . 2>&1 | tee "$log"
result=${PIPESTATUS[0]}
set -e
if [[ "$result" -eq 0 ]]; then state=PASS;else state=FAIL;fi
printf '{"runner":"codespaces-docker","commit":"%s","branch":"%s","state":"%s","exit_code":%s,"scope":"A14.1+A14.2; official TypeSpec, Spring, Nest, PostgreSQL, HTTP, Chromium, and A13 evolution","created_at_utc":"%s","actions_used":false,"render_used":false,"log":"%s"}\n' \
  "$revision" "$branch" "$state" "$result" "$stamp" "$log" > "$report"
printf '\nA14 CODESPACES %s. Full evidence: %s\n' "$state" "$log"
printf 'Result file: %s\n' "$report"
exit "$result"
