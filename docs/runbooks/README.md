# Runbooks

- [Dev stack](dev-stack.md). Bootstrap once, apply the dev stack only while you are using it, then destroy it.
- [Backup and restore](backup-restore.md). Local `pg_dump`, and how a dump leaves RDS.
- [Toxiproxy drill](chaos-drill.md). Cut Postgres and confirm place-order fails, then heals. The k6 script is in the same page.
- [Postmortem](postmortem.md). Copy this after an incident.

`scripts/prepare-aws.sh` checks the tools and the AWS identity. It does not apply Terraform.
