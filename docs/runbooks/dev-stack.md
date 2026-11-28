# Dev stack

Bootstrap stays up. The dev stack is applied only while you are using it, then destroyed. While it exists it costs about a dollar a day. Destroy is the off switch. Stopping the instance or the database is not: AWS starts a stopped database again after seven days, and an Elastic IP still costs money on a stopped instance.

Nothing in this repository applies the stack for you. The workflows `dev-apply` and `dev-destroy` are `workflow_dispatch` only.

Run `./scripts/prepare-aws.sh` from the repo root first. It only reads the CLI, the identity, and whether `terraform.tfvars` exists.

## Install

```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform awscli
terraform version
aws --version
aws sts get-caller-identity
```

`aws sts get-caller-identity` has to show the Free-plan account before the next step. Region is `us-east-1`.

## Bootstrap, once

```bash
cd infra/terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars
```

Edit `budget_email`. Then:

```bash
terraform init
terraform apply
```

This creates the state bucket, the lock table, budget alerts at $20 and $50 of monthly spend, and the GitHub OIDC role `meridian-github-apply`. That role can change the dev stack and is denied NAT, ElastiCache, OpenSearch, MSK, and Amazon MQ. Only `main` on `1lyan/meridian` can assume it. A later bootstrap apply removes the unused nightly role if it is still there.

The commands, and where those values go, are in [aws-deployment.md](aws-deployment.md). Copy the outputs into GitHub repository variables:

- `TF_STATE_BUCKET`
- `TF_LOCK_TABLE`
- `AWS_APPLY_ROLE_ARN`

## Atlas, before the app can start

The click-by-click order is in [aws-deployment.md](aws-deployment.md). In short:

1. Run `dev-apply` once, with `MONGO_URL` still unset. The job is red at **Deploy on the instance**. That is expected. A failure at **Configure AWS credentials** means the GitHub role trust rejected the sign-in and no Elastic IP exists.
2. Copy `elastic_ip` from the successful step **Apply the dev stack** in that same run.
3. In Atlas Network Access, allow that address. Do not allow `0.0.0.0/0`.
4. Store the `mongodb+srv://` connection string as the GitHub secret `MONGO_URL` with `gh secret set MONGO_URL --repo 1lyan/meridian`.
5. Run `dev-apply` again.

The instance refuses to start the containers while that parameter is `unset`.

## Apply and destroy

On GitHub, Actions, `dev-apply`. It builds arm64 images, pushes them to ECR, and starts them on the `t4g.small` with SSM. There is no SSH. With seed left on, the job creates Cognito users `alice` and `bob`, places one order, and waits until the worker marks it `allocated`. Bob must get `404` for that order.

`dev-destroy` deletes the instance, the Elastic IP, RDS, Cognito, ECR images, and the artifact bucket. It does not delete the bootstrap bucket, the lock table, or the roles. Run it when you are done for the day.

Passwords for alice and bob are random and live in SSM under `/meridian/dev/alice_password` and `/meridian/dev/bob_password`. Read one with:

```bash
aws ssm get-parameter --name /meridian/dev/alice_password --with-decryption --query Parameter.Value --output text
```

The API is `http://<elastic-ip>`. Cognito access tokens carry `tenant_id` and `client_id`. Alice's tenant is `6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b`. Bob's is `11111111-1111-4111-8111-111111111111`.

Postgres is RDS `db.t4g.micro`, not reachable from the internet. The instance security group is the only ingress. RabbitMQ and Redis stay on the instance. Keycloak does not run there.

The X-Ray daemon is on the instance. The API does not export spans yet, so the service map stays empty. Container logs go to CloudWatch under `/meridian/*`.

Mailpit stays local. The app does not send mail, so there is no SES identity in this stack.
