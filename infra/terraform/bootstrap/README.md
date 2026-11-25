# Bootstrap

Apply this once, from your machine, and leave it up. It holds the Terraform state bucket, the DynamoDB lock table, the GitHub OIDC roles, and monthly budget alerts at $20 and $50. Those cost pennies. The dev network and databases are a different stack and are destroyed when you are done.

Do not apply it unless the AWS CLI is pointed at the Free-plan account. The steps, including the install commands, are in [docs/runbooks/dev-stack.md](../../../docs/runbooks/dev-stack.md).
