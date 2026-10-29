#!/usr/bin/env bash
# Deploy the maxit swarm stack and wait until it is reachable via BASE_URL.
# Usage: deploy-stack.sh [BASE_URL]   (falls back to $BASE_URL, then e2e/.env)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
STACK_FILE="$DEPLOY_DIR/docker-swarm/maxit-stack.yaml"

BASE_URL="${1:-${BASE_URL:-}}"
if [[ -z "$BASE_URL" && -f "$DEPLOY_DIR/e2e/.env" ]]; then
    BASE_URL=$(grep '^BASE_URL=' "$DEPLOY_DIR/e2e/.env" | cut -d= -f2-)
fi
BASE_URL="${BASE_URL%/}"
if [[ -z "$BASE_URL" ]]; then
    echo "[ERROR] BASE_URL not set. Pass it as arg, export it, or run start-ngrok.sh first." >&2
    exit 1
fi
export BASE_URL
echo "[*] Deploying stack 'maxit' with BASE_URL=$BASE_URL"

RENDERED=$(mktemp)
envsubst '${BASE_URL}' < "$STACK_FILE" > "$RENDERED"

# --resolve-image never: do NOT let the registry's :latest (older published
# builds under seber/*) override the locally built images.
docker stack deploy --resolve-image never -c "$RENDERED" maxit
rm -f "$RENDERED"

echo "[*] Applying database migrations (one-shot atlas container)..."
migration_ok=0
for _ in $(seq 1 15); do
    if docker run --rm --network maxit_default -w /app maxit/backend:latest \
        atlas migrate apply --dir "file://migrations" \
        --url "postgres://postgres:password@db:5432/maxit?sslmode=disable"; then
        migration_ok=1
        break
    fi
    echo "[*] migration attempt failed, retrying in 4s..."
    sleep 4
done
if [[ $migration_ok -ne 1 ]]; then
    echo "[ERROR] database migrations failed" >&2
    exit 1
fi
echo "[OK] migrations applied"

echo "[*] Waiting for services (up to 120s)..."
deadline=$((SECONDS + 120))
nginx_up=0
backend_up=0
while (( SECONDS < deadline )); do
    if [[ $nginx_up -eq 0 ]] && curl -fsS -m 5 "$BASE_URL/health" >/dev/null 2>&1; then
        nginx_up=1
        echo "[OK] nginx up ($BASE_URL/health)"
    fi
    if [[ $backend_up -eq 0 ]]; then
        code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "$BASE_URL/api/v1/status" 2>/dev/null || echo 000)
        if [[ "$code" != "000" ]]; then
            backend_up=1
            echo "[OK] backend reachable (HTTP $code from /api/v1/status)"
        fi
    fi
    if [[ $nginx_up -eq 1 && $backend_up -eq 1 ]]; then
        echo "[OK] stack deployed and reachable"
        exit 0
    fi
    sleep 3
done

echo "[ERROR] stack not reachable in time. Service status:" >&2
docker stack ps maxit --no-trunc >&2 || true
exit 1
