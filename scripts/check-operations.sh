#!/usr/bin/env bash
set -euo pipefail
# Usage: check-operations.sh https://CONFIRMED_DOMAIN /PRIVATE_BACKUP_DIR /APP_DIR
url=${1:?HTTPS origin required}; base=${2:?backup directory}; app=${3:?app directory}
[[ "$url" == https://* && -d "$base" && -d "$app" ]]
# TLS certificate must remain valid for at least 7 days. curl verifies trust/hostname.
curl --fail --silent --show-error --max-time 8 "$url/api/health" | /usr/bin/env node --input-type=module -e '
let s=""; for await (const c of process.stdin) s+=c;
const x=JSON.parse(s); if(x.ok!==true || x.database!=="ok" || "testEnvironment" in x) process.exit(1);'
host=${url#https://}; host=${host%%/*}
timeout 12 openssl s_client -connect "$host:443" -servername "$host" </dev/null 2>/dev/null | openssl x509 -checkend 604800 -noout
for dir in "$app" "$base"; do
 used=$(df -P "$dir" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
 (( used < 85 )) || { echo 'Disk >=85%' >&2; exit 1; }
 inodes=$(df -Pi "$dir" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
 (( inodes < 85 )) || { echo 'Inodes >=85%' >&2; exit 1; }
done
find "$base" -mindepth 2 -maxdepth 2 -name completed-at -mmin -1800 -print -quit | /usr/bin/env node --input-type=module -e '
let s=""; for await(const c of process.stdin)s+=c; if(!s.trim())process.exit(1);'
echo 'Health/TLS/disk/backup-age OK; offsite and restore not covered'
