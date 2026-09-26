#!/bin/sh
set -eu
cd "$(dirname "$0")"
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f compose.yml exec -T database pg_dump -U telepaid -d telepaid -Fc > "backups/database-$stamp.dump"
docker compose -f compose.yml exec -T api tar -C /srv/telepaid/data -czf - metadata > "backups/metadata-$stamp.tar.gz"
printf '%s\n' "Backup complete: $stamp. Copy to encrypted off-server storage; store the encryption key separately."
