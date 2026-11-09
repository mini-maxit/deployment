#!/usr/bin/env bash
# Start an ngrok tunnel to the local nginx (:80) and export BASE_URL.
# Usage: source this file OR run it and read deployment/e2e/.env
# Optional: NGROK_DOMAIN=my-domain.ngrok-free.app for a reserved domain.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$DEPLOY_DIR/.ngrok.pid"
ENV_FILE="$DEPLOY_DIR/e2e/.env"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "[*] ngrok already running (pid $(cat "$PID_FILE"))"
else
    NGROK_ARGS=(http http://localhost:80 --log stdout --log-format json)
    if [[ -n "${NGROK_DOMAIN:-}" ]]; then
        NGROK_ARGS+=(--domain "$NGROK_DOMAIN")
    fi
    ngrok "${NGROK_ARGS[@]}" >> "$DEPLOY_DIR/.ngrok.log" 2>&1 &
    echo $! > "$PID_FILE"
    echo "[*] ngrok started (pid $!)"
fi

BASE_URL=""
for _ in $(seq 1 60); do
    BASE_URL=$(curl -s -m 3 http://localhost:4040/api/tunnels 2>/dev/null \
        | grep -oE '"public_url":"https://[^"]+"' | head -1 | cut -d'"' -f4 || true)
    [[ -n "$BASE_URL" ]] && break
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "[ERROR] ngrok exited early. See $DEPLOY_DIR/.ngrok.log" >&2
        exit 1
    fi
    sleep 2
done

if [[ -z "$BASE_URL" ]]; then
    echo "[ERROR] ngrok tunnel did not come up within 120s. See $DEPLOY_DIR/.ngrok.log" >&2
    exit 1
fi

BASE_URL="${BASE_URL%/}"
mkdir -p "$(dirname "$ENV_FILE")"
grep -v '^BASE_URL=' "$ENV_FILE" 2>/dev/null > "$ENV_FILE.tmp" || true
mv "$ENV_FILE.tmp" "$ENV_FILE"
echo "BASE_URL=$BASE_URL" >> "$ENV_FILE"

echo "[OK] BASE_URL=$BASE_URL"

# Advisory only: the stack may not be deployed yet when this runs (bootstrap
# order is start-ngrok -> deploy-stack), so a non-200 here is not an error.
code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H 'ngrok-skip-browser-warning: 1' "$BASE_URL/health" 2>/dev/null || echo 000)
if [[ "$code" != "200" ]]; then
    echo "[warn] tunnel not serving /health yet (HTTP $code) — expected before deploy-stack.sh runs"
fi
