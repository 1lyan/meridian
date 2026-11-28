output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "lock_table" {
  value = aws_dynamodb_table.lock.name
}

output "apply_role_arn" {
  value = aws_iam_role.apply.arn
}

output "region" {
  value = var.region
}
