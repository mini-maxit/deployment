#!/usr/bin/env bash
# Tear down the maxit stack and ngrok. --purge-volumes also drops maxit_* volumes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$DEPLOY_DIR/.ngrok.pid"

echo "[*] Removing stack 'maxit'..."
docker stack rm maxit 2>/dev/null || echo "[*] stack not deployed"

for _ in $(seq 1 30); do
    if ! docker stack ps maxit -q 2>/dev/null | grep -q .; then
        break
    fi
    sleep 1
done
echo "[OK] stack removed"

if [[ -f "$PID_FILE" ]]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "[OK] ngrok stopped"
fi

if [[ "${1:-}" == "--purge-volumes" ]]; then
    echo "[*] Purging maxit_* volumes..."
    docker volume ls -q | grep '^maxit_' | xargs -r docker volume rm
    echo "[OK] volumes purged"
fi
