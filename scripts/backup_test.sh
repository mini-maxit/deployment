#!/usr/bin/env bash
# End-to-end check of backup.sh against a throwaway Postgres container.
# Needs: docker, age, flock, sha256sum.
# shellcheck disable=SC2016 # single quotes: variables expand inside the container
set -euo pipefail

src=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/maxit-backup-test.XXXXXX")
repo="$work/repo"
out="$work/backups"
project="maxit-backup-test-$$"
dc=(docker compose -f "$repo/docker-compose/docker-compose.yaml")

cleanup() {
	"${dc[@]}" down -v >/dev/null 2>&1 || true
	chmod -R u+rwX "$work"
	rm -rf "$work"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
count() { find "$out" -mindepth 1 -maxdepth 1 ! -name .lock | wc -l | tr -d ' '; }
run() { BACKUP_DIR="$out" "$repo/scripts/backup.sh" >"$work/log" 2>&1; }
expect_failure() { # <case> <expected message>
	local before
	before=$(count)
	if run; then fail "$1: backup succeeded"; fi
	grep -q "$2" "$work/log" || { cat "$work/log" >&2; fail "$1: wrong error"; }
	[ "$(count)" = "$before" ] || fail "$1: left files behind"
	echo "ok: $1"
}

mkdir -p "$repo/scripts" "$repo/docker-compose/volumes/file-storage-media/task" "$repo/nginx/ssl" "$out"
cp "$src/backup.sh" "$repo/scripts/"
cat >"$repo/docker-compose/docker-compose.yaml" <<EOF
name: $project
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: tester
      POSTGRES_PASSWORD: throwaway
      POSTGRES_DB: maxit
EOF
echo "uploaded-file-marker" >"$repo/docker-compose/volumes/file-storage-media/task/solution.txt"
echo "ENV_MARKER=1" >"$repo/docker-compose/.env"
age-keygen -o "$work/key.txt" 2>/dev/null
recipients="$repo/docker-compose/backup.recipients"

"${dc[@]}" up -d >/dev/null 2>&1
# -h 127.0.0.1: the image's init-time server listens on the socket only.
for _ in $(seq 60); do
	"${dc[@]}" exec -T db pg_isready -q -h 127.0.0.1 -U tester -d maxit && break
	sleep 1
done
"${dc[@]}" exec -T db psql -q -v ON_ERROR_STOP=1 -U tester -d maxit \
	-c "CREATE TABLE t (v text); INSERT INTO t VALUES ('db-row-marker');"

expect_failure "missing recipients file" "backup.recipients"
echo "not-a-key" >"$recipients"
expect_failure "invalid recipient" "invalid recipient"
age-keygen -y "$work/key.txt" >"$recipients"

mv "$repo/docker-compose/.env" "$work/env.hidden"
expect_failure "missing .env" "\.env"
mv "$work/env.hidden" "$repo/docker-compose/.env"

run || { cat "$work/log" >&2; fail "backup failed"; }
[ "$(count)" = 1 ] || fail "expected exactly one backup directory"
b=$(find "$out" -mindepth 1 -maxdepth 1 -name 'maxit-*Z')
[ -n "$b" ] || fail "backup directory name"
(cd "$b" && sha256sum -c SHA256SUMS >/dev/null) || fail "checksums"
# shellcheck disable=SC2012 # fixed file names
[ "$(ls "$b" | tr '\n' ' ')" = "SHA256SUMS db.dump.age files.tar.gz.age " ] || fail "unexpected contents: $(ls "$b")"
[ -z "$(find "$b" -perm -040 -o -perm -004)" ] || fail "backup readable by group or others"
head -c 21 "$b/db.dump.age" | grep -q "age-encryption.org" || fail "db dump not encrypted"
head -c 21 "$b/files.tar.gz.age" | grep -q "age-encryption.org" || fail "files not encrypted"
echo "ok: backup created"

# Restore exactly as documented in backup.md.
"${dc[@]}" exec -T db sh -c 'dropdb --force -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
age -d -i "$work/key.txt" "$b/db.dump.age" |
	"${dc[@]}" exec -T db sh -c 'exec pg_restore --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
row=$("${dc[@]}" exec -T db psql -tA -U tester -d maxit -c 'SELECT v FROM t')
[ "$row" = "db-row-marker" ] || fail "restored row: $row"
mkdir "$work/restore"
age -d -i "$work/key.txt" "$b/files.tar.gz.age" | tar -C "$work/restore" -xzf -
diff -r "$repo/docker-compose/volumes/file-storage-media" "$work/restore/docker-compose/volumes/file-storage-media" || fail "media differs"
cmp "$repo/docker-compose/.env" "$work/restore/docker-compose/.env" || fail ".env differs"
echo "ok: restore"

sleep 1 # next run needs a new timestamp
exec 8>"$out/.lock"
flock -n 8
expect_failure "concurrent run" "already running"
exec 8>&-

chmod 000 "$repo/docker-compose/volumes/file-storage-media/task/solution.txt"
expect_failure "unreadable upload (fails mid-backup)" "solution.txt"
chmod 600 "$repo/docker-compose/volumes/file-storage-media/task/solution.txt"

"${dc[@]}" stop db >/dev/null 2>&1
expect_failure "database stopped" "database is not ready"

echo "PASS"
