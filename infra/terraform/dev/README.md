# Dev stack

Phase 5. Do not apply this stack during phase 0.

The applied shape is one VPC without a NAT gateway, one `t4g.small`, RDS Postgres `db.t4g.micro`, and an Elastic IP. Terraform will refuse a NAT gateway. Apply it only while you are using it, then destroy it. A stopped RDS instance is not the off switch: AWS restarts it after seven days. See ADR 0008.
