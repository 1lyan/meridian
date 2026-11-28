locals {
  database_url = "postgres://meridian:${random_password.database.result}@${aws_db_instance.main.address}:5432/meridian?sslmode=no-verify"
  issuer       = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  mongo_url    = var.mongo_url == "" ? "unset" : var.mongo_url
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/meridian/dev/database_url"
  type  = "SecureString"
  value = local.database_url
}

resource "aws_ssm_parameter" "mongo_url" {
  name  = "/meridian/dev/mongo_url"
  type  = "SecureString"
  value = local.mongo_url
}

resource "aws_ssm_parameter" "identity_issuer" {
  name  = "/meridian/dev/identity_issuer"
  type  = "String"
  value = local.issuer
}

resource "aws_ssm_parameter" "identity_audience" {
  name  = "/meridian/dev/identity_audience"
  type  = "String"
  value = aws_cognito_user_pool_client.api.id
}

resource "aws_ssm_parameter" "ecr_registry" {
  name  = "/meridian/dev/ecr_registry"
  type  = "String"
  value = split("/", aws_ecr_repository.app["meridian-api"].repository_url)[0]
}

resource "random_password" "alice" {
  length      = 16
  special     = false
  min_lower   = 1
  min_upper   = 1
  min_numeric = 1
}

resource "random_password" "bob" {
  length      = 16
  special     = false
  min_lower   = 1
  min_upper   = 1
  min_numeric = 1
}

resource "aws_ssm_parameter" "alice_password" {
  name  = "/meridian/dev/alice_password"
  type  = "SecureString"
  value = random_password.alice.result
}

resource "aws_ssm_parameter" "bob_password" {
  name  = "/meridian/dev/bob_password"
  type  = "SecureString"
  value = random_password.bob.result
}
