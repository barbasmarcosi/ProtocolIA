#!/usr/bin/env bash
# Codespaces setup doctor: passive diagnostics, no long-running builds.
set -uo pipefail
printf '\nProtocolIA Codespaces Docker readiness check\n'
printf 'Repository HEAD: '; git rev-parse --short HEAD 2>/dev/null || true
printf 'Branch: '; git branch --show-current 2>/dev/null || true
printf 'Docker CLI: '
if ! command -v docker >/dev/null 2>&1; then
  echo 'NOT FOUND'
  echo 'Rebuild this Codespace using the repository devcontainer (Docker-in-Docker v4).' >&2
  exit 2
fi
docker --version || true
printf 'Docker socket: '
if [[ -S /var/run/docker.sock ]]; then
  ls -l /var/run/docker.sock
else
  echo 'NOT FOUND /var/run/docker.sock'
fi
printf 'Daemon connectivity: '
if docker info --format '{{.ServerVersion}}' >/dev/null 2>&1; then
  docker info --format 'READY — engine {{.ServerVersion}}' 2>/dev/null
  echo 'Next: bash scripts/vnext/run-codespaces-a14.sh'
  exit 0
fi
echo 'UNAVAILABLE'
printf '\nDocker error details:\n'
docker version 2>&1 | tail -n 22 || true
printf '\nExpected devcontainer feature: ghcr.io/devcontainers/features/docker-in-docker:4\n'
printf 'Repair: git pull --ff-only; Codespaces: Rebuild Container; retry the runner.\n'
exit 2
