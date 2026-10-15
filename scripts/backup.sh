#!/usr/bin/env bash
set -euo pipefail
umask 077
# Invoke with a private, trusted shell config path; never source application .env.
source "${1:?usage: backup.sh /private/backup.env}"
: "${PGSERVICE:?}" "${PGSERVICEFILE:?}" "${PGPASSFILE:?}" "${APP_DIR:?}" "${BACKUP_DIR:?}" "${RETENTION_DAYS:?}"
export PGSERVICE PGSERVICEFILE PGPASSFILE
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && (( RETENTION_DAYS >= 2 ))
app=$(realpath -e "$APP_DIR")
mkdir -p "$BACKUP_DIR"
base=$(realpath -e "$BACKUP_DIR")
[[ "$base" != / && "$base" != "$app" && "$base" != "$app/"* ]]
[[ -d "$app/uploads" ]]
exec 9>"$base/.backup.lock"
flock -n 9 || { echo 'Backup already running' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
staging=$(mktemp -d "$base/.incomplete-XXXXXXXX")
trap 'rm -rf -- "$staging"' EXIT
# Password comes from pgpass, never argv. Client must match server major version.
pg_dump --no-password --format=custom --file="$staging/database.dump"
pg_restore --list "$staging/database.dump" >/dev/null
tar -czf "$staging/uploads.tar.gz" -C "$app" uploads
(
 cd "$staging"
 sha256sum database.dump uploads.tar.gz > SHA256SUMS
)
date -u +%FT%TZ > "$staging/completed-at"
mv -- "$staging" "$base/sibdel-$stamp"
# Retention only after success, only this script's completed backup directories.
find "$base" -mindepth 1 -maxdepth 1 -type d -name 'sibdel-????????T??????Z' -mtime +"$RETENTION_DAYS" -exec rm -rf -- {} +
echo 'Backup complete; restore and offsite verification still required'
