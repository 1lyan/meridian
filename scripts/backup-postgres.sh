#!/bin/sh
# Logical backup of the local meridian database. Does not touch AWS.
set -eu

url="${DATABASE_URL:-postgres://meridian:meridian@127.0.0.1:5432/meridian}"
out="${1:-backups/meridian-$(date +%Y%m%dT%H%M%S).dump}"
mkdir -p "$(dirname "$out")"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is not on PATH. On this machine it is installed with: brew install postgresql@18"
  echo "Then: export PATH=\"/opt/homebrew/opt/postgresql@18/bin:\$PATH\""
  exit 1
fi

pg_dump --format=custom --no-owner --file "$out" "$url"
echo "wrote $out"
