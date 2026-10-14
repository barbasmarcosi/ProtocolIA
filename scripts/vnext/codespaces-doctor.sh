#!/usr/bin/env bash
# Lightweight readiness report; does not start tests or bill additional build minutes.
set -uo pipefail
printf '\nProtocolIA Codespaces: checking Docker availability...\n'
printf 'Git branch: '; git branch --show-current || true
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker CLI unavailable: check devcontainer initialization.' >&2
  exit 0
fi
if docker info >/dev/null 2>&1; then
  echo 'Docker daemon available. Run: bash scripts/vnext/run-codespaces-a14.sh'
else
  echo 'Docker daemon not yet available. Wait for devcontainer initialization, then run the same command.' >&2
fi
