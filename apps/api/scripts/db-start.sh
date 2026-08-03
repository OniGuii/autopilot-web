#!/usr/bin/env bash
# Start local Postgres + Redis for AutoPilot API.
# Prefers Docker Compose; falls back to native services when Docker is unavailable.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v docker >/dev/null 2>&1; then
  echo "[db:start] Using Docker Compose (postgres + redis)"
  docker compose up -d postgres redis
  for _ in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U autopilot -d autopilot >/dev/null 2>&1; then
      echo "[db:start] Postgres is ready"
      exit 0
    fi
    sleep 1
  done
  echo "[db:start] WARNING: Postgres healthcheck timed out" >&2
  exit 1
fi

echo "[db:start] Docker not found — attempting native Postgres/Redis"

if command -v pg_ctlcluster >/dev/null 2>&1; then
  # Ubuntu/Debian clusters
  if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    sudo pg_ctlcluster 16 main start || sudo pg_ctlcluster 15 main start || true
  fi
elif command -v pg_ctl >/dev/null 2>&1; then
  echo "[db:start] Ensure PostgreSQL is running (pg_ctl)"
fi

if command -v redis-cli >/dev/null 2>&1; then
  if ! redis-cli ping >/dev/null 2>&1; then
    if command -v redis-server >/dev/null 2>&1; then
      redis-server --daemonize yes --port 6379 || sudo redis-server --daemonize yes --port 6379 || true
    fi
  fi
fi

if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  echo "[db:start] ERROR: PostgreSQL is not accepting connections on localhost:5432" >&2
  echo "Install Docker or PostgreSQL 16 and create role/db autopilot/autopilot." >&2
  exit 1
fi

if command -v redis-cli >/dev/null 2>&1; then
  redis-cli ping >/dev/null || echo "[db:start] WARNING: Redis not responding (optional for current foundation)"
fi

# Ensure role/database exist (best-effort; requires local peer/sudo access)
if command -v sudo >/dev/null 2>&1 && id -u postgres >/dev/null 2>&1 || getent passwd postgres >/dev/null 2>&1; then
  sudo -u postgres psql -v ON_ERROR_STOP=0 <<'SQL' >/dev/null 2>&1 || true
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'autopilot') THEN
    CREATE ROLE autopilot LOGIN PASSWORD 'autopilot';
  END IF;
END
$$;
SQL
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='autopilot'" | grep -q 1 \
    || sudo -u postgres createdb -O autopilot autopilot >/dev/null 2>&1 || true
  sudo -u postgres psql -d autopilot -c "GRANT ALL ON SCHEMA public TO autopilot; ALTER SCHEMA public OWNER TO autopilot;" >/dev/null 2>&1 || true
fi

echo "[db:start] Native infra ready (Postgres on :5432)"
