#!/usr/bin/env bash
# Build the four maxit service images with the tags expected by the swarm stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[1/4] Building maxit/backend:latest ..."
docker build -t maxit/backend:latest "$ROOT/backend"

echo "[2/4] Building maxit/frontend:latest ..."
docker build -t maxit/frontend:latest "$ROOT/frontend-2.0"

echo "[3/4] Building seber/maxit-file-storage:latest + maxit/file-storage:local ..."
docker build -t seber/maxit-file-storage:latest -t maxit/file-storage:local "$ROOT/file-storage"

echo "[4/4] Building seber/maxit-worker:latest + maxit/worker:local ..."
docker build -t seber/maxit-worker:latest -t maxit/worker:local "$ROOT/worker"

echo "All images built:"
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'maxit/(backend|frontend|file-storage|worker)|seber/maxit-(file-storage|worker)'
