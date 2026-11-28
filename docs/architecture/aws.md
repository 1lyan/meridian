# AWS dev stack

Bootstrap is the state bucket, the lock table, the GitHub apply role, and monthly budgets at $20 and $50. It stays up.

The dev stack is one VPC, two public subnets, and an internet gateway. There is no NAT gateway. `enable_nat` cannot be true, and the apply role is denied `ec2:CreateNatGateway`. RDS Postgres 16 (`db.t4g.micro`) has no public address. Its security group allows port 5432 only from the instance. The instance is a `t4g.small` with an Elastic IP, Docker, and the same services as local Compose except Postgres and Keycloak: API, worker, Caddy, RabbitMQ, Redis, and the X-Ray daemon. RDS connections use `sslmode=no-verify` because RDS rejects unencrypted sessions. SSM Run Command deploys it. Port 22 is closed.

Cognito is the AWS issuer. A pre-token Lambda copies `custom:tenant_id` to the `tenant_id` claim. Access tokens identify the audience with `client_id`, and the API accepts that in place of `aud`. Keycloak tokens are unchanged.

MongoDB is an Atlas M0 cluster you create, allowlisted to the Elastic IP. The app turns off `directConnection` for `mongodb+srv` URLs.

Images are built for `linux/arm64` because the instance is Graviton. `dev-apply` pushes them, then seeds alice and bob and waits for one allocated order. `dev-destroy` removes the dev stack and leaves bootstrap.

Container logs go to CloudWatch. The X-Ray daemon is running. The API does not export spans yet.

The operator steps are in [docs/runbooks/dev-stack.md](../runbooks/dev-stack.md).
