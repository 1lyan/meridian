output "elastic_ip" {
  value = aws_eip.main.public_ip
}

output "instance_id" {
  value = aws_instance.main.id
}

output "api_url" {
  value = "http://${aws_eip.main.public_ip}"
}

output "artifact_bucket" {
  value = aws_s3_bucket.artifacts.bucket
}

output "ecr_registry" {
  value = split("/", aws_ecr_repository.app["meridian-api"].repository_url)[0]
}

output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.api.id
}

output "identity_issuer" {
  value = local.issuer
}
