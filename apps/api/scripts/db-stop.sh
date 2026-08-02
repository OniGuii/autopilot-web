#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v docker >/dev/null 2>&1; then
  echo "[db:stop] Stopping Docker Compose postgres + redis"
  docker compose stop postgres redis
  exit 0
fi

echo "[db:stop] Docker not found — leaving native Postgres/Redis running"
echo "[db:stop] Tip: sudo pg_ctlcluster 16 main stop; sudo redis-cli shutdown"
exit 0
