# Backup and restore

Local backups are logical dumps. `pg_dump` and `pg_restore` come with Postgres:

```bash
brew install postgresql@18
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
pg_dump --version
```

Dump the local database:

```bash
set -a && source .env && set +a
./scripts/backup-postgres.sh
```

The file lands in `backups/`, which is not committed. Restore it over the same database:

```bash
./scripts/restore-postgres.sh backups/<file>.dump
```

Restore drops and recreates objects in the target database. Take a fresh dump first. After a restore, `pnpm migrate` is safe: applied migrations are already recorded in `schema_migrations`.

Confirm the restore with a query:

```bash
psql "$DATABASE_URL" -c 'select count(*) from orders;'
```

## RDS

The dev stack already keeps one day of automated RDS backups. That is not a substitute for a dump you can read.

RDS has no public address. From a machine that can reach it (the EC2 instance, via SSM), use the same `pg_dump` against `DATABASE_URL` from SSM `/meridian/dev/database_url`. Copy the dump off the instance with `aws s3 cp` to the artifact bucket, then download it. Restore that file onto local Postgres with `scripts/restore-postgres.sh` and run the saga checks there.

Do not restore a dump onto the live RDS instance as a drill. Create a second database only if you mean to pay for it, and destroy it the same day. `dev-destroy` deletes the original instance. Destroy is still the off switch. A snapshot you keep after destroy is the one piece that continues to cost storage.
