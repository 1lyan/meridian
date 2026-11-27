# AWS deployment

Bootstrap is applied from this machine. The dev stack is applied later by the GitHub Action `dev-apply`. These steps create the state bucket, the lock table, the budget alerts, and the two GitHub roles. They do not create the EC2 instance or the database.

The four names below are GitHub repository variables on `1lyan/meridian`. They do not go in the root `.env`. That file is only for the local API, worker, and agent.

`aws sts get-caller-identity` must show the Free-plan account, and the CLI region must be `us-east-1`. `infra/terraform/bootstrap/terraform.tfvars` must exist and must set `budget_email`. Copy it from `terraform.tfvars.example` if it is missing. The file is gitignored.

## Bootstrap

From `infra/terraform/bootstrap`:

```bash
terraform init
terraform apply
```

`terraform apply` prints a plan and waits for `yes`. AWS mails `budget_email` to confirm the budget subscription. The alerts fire at $20 and at $50 of monthly spend.

Still in that directory, print the values:

```bash
terraform output
```

| GitHub variable        | Terraform output   |
| ---------------------- | ------------------ |
| `TF_STATE_BUCKET`      | `state_bucket`     |
| `TF_LOCK_TABLE`        | `lock_table`       |
| `AWS_APPLY_ROLE_ARN`   | `apply_role_arn`   |
| `AWS_NIGHTLY_ROLE_ARN` | `nightly_role_arn` |

## GitHub variables

From the repo root, substitute the printed values:

```bash
gh variable set TF_STATE_BUCKET --repo 1lyan/meridian --body "<state_bucket>"
gh variable set TF_LOCK_TABLE --repo 1lyan/meridian --body "<lock_table>"
gh variable set AWS_APPLY_ROLE_ARN --repo 1lyan/meridian --body "<apply_role_arn>"
gh variable set AWS_NIGHTLY_ROLE_ARN --repo 1lyan/meridian --body "<nightly_role_arn>"
```

The same settings are in the browser under the repository's Settings, Secrets and variables, Actions, Variables. These are variables, not secrets.

## Dev stack

Bootstrap is already applied, and the four GitHub variables are set. The dev stack costs about a dollar a day until `dev-destroy`. That workflow removes the instance, the Elastic IP, and RDS. Bootstrap stays.

1. Confirm the budget email. AWS sent it to `illia.yuriev.nechyporenko@gmail.com`. The alerts start after that confirmation.

2. Create the Atlas cluster. In MongoDB Atlas, create a free M0 cluster, a database user, and a connection string for the database `meridian`. Leave Network Access empty until the Elastic IP exists.

3. Run `dev-apply` once. On GitHub, open Actions, choose `dev-apply`, and run it with seed left on. The job creates the instance, RDS, Cognito, and the Elastic IP. It then fails while `MONGO_URL` is missing, so the containers do not start and the seed does not run. A red job at that step is the expected result. In the apply log, copy the Elastic IP from the Terraform outputs. `api_url` is `http://<that-ip>`.

4. Allow that IP and store the secret. In Atlas, Network Access, allow the Elastic IP. From the repo root, store the connection string without pasting it into chat:

```bash
gh secret set MONGO_URL --repo 1lyan/meridian
```

The command prompts for the value.

5. Run `dev-apply` again. This start succeeds. Seed creates Cognito users `alice` and `bob`, places one order, and waits until its status is `allocated`.

The API is `http://<elastic-ip>`. The passwords are random values in SSM, not `alice` and `bob`:

```bash
aws ssm get-parameter --name /meridian/dev/alice_password --with-decryption --query Parameter.Value --output text
```

The same procedure is summarized in [dev-stack.md](dev-stack.md).
