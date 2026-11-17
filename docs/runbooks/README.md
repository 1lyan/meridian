# Runbooks

Backup, restore, and the Toxiproxy drill land in phase 6, after the saga and the dev stack exist. Until then the recovery path for local Postgres is `docker compose down -v` and a fresh migrate. That is safe because phase 0 has no data you need to keep.
