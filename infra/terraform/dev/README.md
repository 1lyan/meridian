# Dev stack

One VPC with public subnets and no NAT gateway, one `t4g.small`, RDS Postgres `db.t4g.micro` closed to the instance security group, one Elastic IP, ECR, Cognito, SSM, and CloudWatch. Terraform refuses `enable_nat = true`. The apply role is also denied `ec2:CreateNatGateway`.

Apply it from the `dev-apply` workflow while you are using it, then run `dev-destroy`. A stopped database is not the off switch. See [docs/runbooks/dev-stack.md](../../../docs/runbooks/dev-stack.md) and ADR 0008.

State is in the bootstrap bucket. This directory does not apply itself.
