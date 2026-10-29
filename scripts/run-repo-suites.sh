#!/usr/bin/env bash
# Run every repo-native test suite and summarize results.
# Suites: backend (go test), file-storage (go test), worker (integration + e2e
# scripts with their own docker-compose harness), frontend (svelte-check + lint).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/deployment/e2e/logs/repo-suites"
mkdir -p "$LOG_DIR"

declare -a NAMES RESULTS

run_suite() {
    local name="$1"; shift
    local log="$LOG_DIR/${name}.log"
    echo "[*] Running $name ..."
    if "$@" > "$log" 2>&1; then
        RESULTS+=("PASS"); echo "    PASS (log: $log)"
    else
        RESULTS+=("FAIL"); echo "    FAIL (log: $log)"
    fi
    NAMES+=("$name")
}

run_suite backend-go-test    bash -c "cd '$ROOT/backend' && go test ./... 2>&1"
run_suite file-storage-go-test bash -c "cd '$ROOT/file-storage' && go test ./... 2>&1"
run_suite worker-go-test     bash -c "cd '$ROOT/worker' && go test ./... 2>&1"
run_suite worker-integration bash -c "cd '$ROOT/worker' && bash run_integration_tests.sh"
run_suite worker-e2e         bash -c "cd '$ROOT/worker' && bash run_e2e_tests.sh"
run_suite frontend-check     bash -c "cd '$ROOT/frontend-2.0' && pnpm run check"
run_suite frontend-lint      bash -c "cd '$ROOT/frontend-2.0' && pnpm run lint"

echo
echo "===== Repo suite summary ====="
exit_code=0
for i in "${!NAMES[@]}"; do
    printf '%-24s %s\n' "${NAMES[$i]}" "${RESULTS[$i]}"
    [[ "${RESULTS[$i]}" == "FAIL" ]] && exit_code=1
done
exit $exit_code
