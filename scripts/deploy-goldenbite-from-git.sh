#!/usr/bin/env bash
set -Eeuo pipefail

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
live_backend="${SHARKOS_BACKEND_DIR:-/opt/sullyos-backend}"
live_frontend="${SHARKOS_FRONTEND_DIR:-/opt/sullyos-frontend}"

for command in docker git rsync; do
  command -v "${command}" >/dev/null 2>&1 || { echo "Missing command: ${command}" >&2; exit 1; }
done
docker compose version >/dev/null

if [[ ! -d "${source_dir}/.git" || "${live_backend}" != /opt/sullyos-backend || "${live_frontend}" != /opt/sullyos-frontend ]]; then
  echo "Run this from the SharkOS deploy clone with the production target paths." >&2
  exit 1
fi
if [[ ! -f "${live_backend}/.env.production" ]]; then
  echo "Production environment is missing: ${live_backend}/.env.production" >&2
  exit 1
fi

commit="$(git -C "${source_dir}" rev-parse --short=12 HEAD)"
uid="$(id -u)"
gid="$(id -g)"
mkdir -p "${source_dir}/.deploy-cache/corepack"

echo "Building SharkOS ${commit}..."
docker run --rm \
  --user "${uid}:${gid}" \
  -e HOME=/tmp \
  -e COREPACK_HOME=/workspace/.deploy-cache/corepack \
  -v "${source_dir}:/workspace" \
  -w /workspace \
  node:24-bookworm-slim \
  bash -lc 'corepack enable && pnpm install --frozen-lockfile && pnpm build'

compose=(docker compose --env-file "${live_backend}/.env.production" -f "${live_backend}/compose.production.yaml")
worker_running=false
if "${compose[@]}" --profile heartbeat ps --status running --services 2>/dev/null | grep -qx worker; then
  worker_running=true
fi

BACKUP_DIR="${live_backend}/backups" bash "${live_backend}/scripts/backup-database.sh" --production

rsync -a --delete "${source_dir}/dist/" "${live_frontend}/"
rsync -a --delete \
  --exclude '.env' \
  --exclude '.env.production' \
  --exclude 'backups/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  "${source_dir}/backend/" "${live_backend}/"

compose=(docker compose --env-file "${live_backend}/.env.production" -f "${live_backend}/compose.production.yaml")
profile=()
if [[ "${worker_running}" == true ]]; then
  profile=(--profile heartbeat)
fi

SULLYOS_IMAGE_TAG="sharkos-${commit}" "${compose[@]}" "${profile[@]}" up -d --build --remove-orphans
bash "${live_backend}/scripts/healthcheck-production.sh" "${live_backend}/.env.production"

echo "Deployed SharkOS ${commit}. Heartbeat worker restored: ${worker_running}."
