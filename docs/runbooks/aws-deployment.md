# AWS deployment

Bootstrap is applied from this machine. The dev stack is applied later by the GitHub Action `dev-apply`. These steps create the state bucket, the lock table, the budget alerts, and the two GitHub roles. They do not create the EC2 instance or the database.

The three names below are GitHub repository variables on `1lyan/meridian`. They do not go in the root `.env`. That file is only for the local API and worker.

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

| GitHub variable      | Terraform output |
| -------------------- | ---------------- |
| `TF_STATE_BUCKET`    | `state_bucket`   |
| `TF_LOCK_TABLE`      | `lock_table`     |
| `AWS_APPLY_ROLE_ARN` | `apply_role_arn` |

## GitHub variables

From the repo root, substitute the printed values:

```bash
gh variable set TF_STATE_BUCKET --repo 1lyan/meridian --body "<state_bucket>"
gh variable set TF_LOCK_TABLE --repo 1lyan/meridian --body "<lock_table>"
gh variable set AWS_APPLY_ROLE_ARN --repo 1lyan/meridian --body "<apply_role_arn>"
```

The same settings are in the browser under the repository's Settings, Secrets and variables, Actions, Variables. These are variables, not secrets.

## Dev stack

Confirm the budget email AWS sent to `budget_email`. The alerts start after that confirmation.

Create the Atlas M0 cluster before the first `dev-apply`. The database user and the database are both named `meridian`. Choose AWS in `us-east-1`. Copy the `mongodb+srv://` connection string and keep it locally. Leave Atlas Network Access empty. Do not allow `0.0.0.0/0`.

GitHub's token subject includes the owner id and the repository id: `repo:1lyan@807091/meridian@1461829565:ref:refs/heads/main`. If bootstrap was applied before that subject was in `oidc.tf`, apply bootstrap again from `infra/terraform/bootstrap` so the role trust matches. A `dev-apply` that dies on `Could not assume role with OIDC` created nothing. There is no Elastic IP in that log.

The dev stack costs about a dollar a day from the moment the first apply creates the instance, even if a later step fails. `dev-destroy` removes the instance, the Elastic IP, and RDS. Bootstrap and the Atlas cluster stay.

1. Run `dev-apply` once. On GitHub, open Actions, choose `dev-apply`, and run the workflow with seed left on. From the repo root the same start is `gh workflow run dev-apply --repo 1lyan/meridian`. Leave `MONGO_URL` unset. Terraform creates the instance, RDS, Cognito, and the Elastic IP. The deploy step then fails because Mongo is missing, and the seed does not run. A red job at **Deploy on the instance** is the expected result of this first run.

2. Copy the Elastic IP from that failed run. Open the run in GitHub Actions. The address is in the earlier successful step **Apply the dev stack**, in the Terraform outputs:

   ```text
   elastic_ip = "x.x.x.x"
   api_url = "http://x.x.x.x"
   ```

   It is not in the red deploy step. If the failed step is **Configure AWS credentials**, stop. The sign-in failed and no address exists. If the failed step is **Push arm64 images**, the address is still in **Apply the dev stack**. The image was not pushed. Allow the address, store `MONGO_URL`, and run `dev-apply` again after the image fix is on `main`.

3. Allow that address in Atlas. In Network Access, add `x.x.x.x`. Do not allow `0.0.0.0/0`.

4. Store the connection string. From the repo root, without pasting the string into chat:

   ```bash
   gh secret set MONGO_URL --repo 1lyan/meridian
   ```

   The command prompts for the `mongodb+srv://` value.

5. Run `dev-apply` again, the same way as step 1. This run should finish green. Seed creates Cognito users `alice` and `bob`, places one order, and waits until its status is `allocated`.

A `502` from `/health` means Caddy is up and the API process is not. RDS Postgres requires an encrypted connection. The database URL stored for the instance ends in `sslmode=no-verify`. Without that, the API logs `no pg_hba.conf entry ... no encryption` and never listens, and Caddy answers `502`. That URL is written on the next `dev-apply` after the change is on `main`.

The API is `http://<elastic-ip>`. The passwords are random values in SSM, not `alice` and `bob`:

```bash
aws ssm get-parameter --name /meridian/dev/alice_password --with-decryption --query Parameter.Value --output text
```

Alice's tenant is `6f1e2c4a-8b3d-4e5f-9a70-1c2d3e4f5a6b`. Bob's is `11111111-1111-4111-8111-111111111111`. Bob's token gets `404` for Alice's order. [dev-stack.md](dev-stack.md) has the same order of steps.
