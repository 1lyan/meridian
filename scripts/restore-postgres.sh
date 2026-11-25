#!/bin/sh
# Restores a custom-format dump over the target database.
set -eu

dump="${1:?Usage: scripts/restore-postgres.sh backups/<file>.dump}"
url="${DATABASE_URL:-postgres://meridian:meridian@127.0.0.1:5432/meridian}"

if [ ! -f "$dump" ]; then
  echo "Dump not found: $dump"
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is not on PATH. On this machine it is installed with: brew install postgresql@18"
  echo "Then: export PATH=\"/opt/homebrew/opt/postgresql@18/bin:\$PATH\""
  exit 1
fi

echo "Restoring $dump into $url"
echo "This overwrites objects in that database. Ctrl-C within 5 seconds to stop."
sleep 5
pg_restore --clean --if-exists --no-owner --dbname "$url" "$dump"
echo "restored $dump"
