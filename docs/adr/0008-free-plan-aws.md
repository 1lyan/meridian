# ADR 0008: Free-plan AWS, destroyed when idle

## Status

Accepted

## Context

A new AWS Free plan grants up to $200 in credits and closes when the credits hit zero or after six months. NAT gateways, an idle Application Load Balancer, Amazon MQ, ElastiCache, and OpenSearch spend that balance while nobody is learning. DocumentDB, MSK, Fault Injection Service, IAM Identity Center, and Managed Grafana are outside the Free plan.

## Decision

Bootstrap (state bucket, lock table, GitHub OIDC role, budget alerts at $20 and $50) stays up. The dev stack is applied only while it is in use and destroyed afterwards: one VPC with public subnets and no NAT, one `t4g.small`, RDS Postgres `db.t4g.micro` closed to the instance security group, one Elastic IP, ECR, Cognito, SSM Parameter Store, and SSM Run Command. Terraform refuses a NAT gateway. MongoDB in AWS is an Atlas M0 cluster. The model provider is Bedrock, called only by the nightly eval. Chaos stays on Toxiproxy. Dashboards stay on the local Grafana profile, with CloudWatch and X-Ray as the AWS view.

While the stack exists it costs about a dollar a day. Destroy is the off switch. A stopped RDS instance restarts after seven days and a stopped instance can keep the Elastic IP charge.

## Consequences

Phase 5 writes this Terraform. Nothing in phase 0 applies it. ECS task roles, an ALB, Amazon MQ, ElastiCache, and OpenSearch stay unapplied until there is a measured reason and a budget for them.
