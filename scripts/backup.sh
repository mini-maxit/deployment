#!/usr/bin/env bash
# Encrypted backup of the maxit database and uploaded files. Usage and restore: backup.md
# shellcheck disable=SC2016 # single quotes: variables expand inside the container
set -euo pipefail
export LC_ALL=C
umask 077

die() { echo "backup: $*" >&2; exit 1; }

repo=$(cd "$(dirname "$0")/.." && pwd)
backup_dir=${BACKUP_DIR:-/var/backups/maxit}
recipients=${AGE_RECIPIENTS_FILE:-$repo/docker-compose/backup.recipients}
files=(docker-compose/volumes/file-storage-media docker-compose/.env nginx/ssl)
dc=(docker compose --project-directory "$repo/docker-compose" -f "$repo/docker-compose/docker-compose.yaml")

for tool in docker age flock sha256sum tar; do
	command -v "$tool" >/dev/null || die "missing tool: $tool"
done
[ -s "$recipients" ] || die "missing or empty recipients file: $recipients"
age -R "$recipients" </dev/null >/dev/null || die "invalid recipient in $recipients"
for path in "${files[@]}"; do
	[ -e "$repo/$path" ] || die "missing path: $repo/$path"
done

mkdir -p "$backup_dir"
exec 9>"$backup_dir/.lock"
flock -n 9 || die "another backup is already running"

"${dc[@]}" exec -T db sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' </dev/null ||
	die "database is not ready"

target="$backup_dir/maxit-$(date -u +%Y%m%dT%H%M%SZ)"
[ ! -e "$target" ] || die "already exists: $target"
partial=$(mktemp -d "$backup_dir/.partial.XXXXXX")
trap 'rm -rf "$partial"' EXIT
trap 'exit 1' HUP INT TERM

# Database first: uploads that arrive afterwards are extra files, not missing ones.
"${dc[@]}" exec -T db sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' </dev/null |
	age -R "$recipients" -o "$partial/db.dump.age"

# shortcut: a file changing while tar reads it fails the run; snapshot the volume if that becomes frequent.
tar -C "$repo" -czf - "${files[@]}" | age -R "$recipients" -o "$partial/files.tar.gz.age"

(cd "$partial" && sha256sum db.dump.age files.tar.gz.age >SHA256SUMS)
sync
mv "$partial" "$target"
echo "$target"
