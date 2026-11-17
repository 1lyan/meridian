# Bootstrap

Phase 5. Do not apply this stack during phase 0.

When it exists it will hold the Terraform state bucket, the DynamoDB lock table, the GitHub OIDC role, and budget alerts at $20 and $50. It stays up between sessions because those resources cost pennies. The dev network and databases are destroyed when you are done. See ADR 0008.
