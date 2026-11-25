data "archive_file" "claims" {
  type        = "zip"
  source_file = "${path.module}/../../aws/cognito-claims.js"
  output_path = "${path.module}/cognito-claims.zip"
}

resource "aws_iam_role" "claims" {
  name = "meridian-cognito-claims"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "claims" {
  role       = aws_iam_role.claims.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "claims" {
  function_name    = "meridian-cognito-claims"
  role             = aws_iam_role.claims.arn
  runtime          = "nodejs20.x"
  handler          = "cognito-claims.handler"
  filename         = data.archive_file.claims.output_path
  source_code_hash = data.archive_file.claims.output_base64sha256
}

resource "aws_cognito_user_pool" "main" {
  name = "meridian"

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  username_configuration {
    case_sensitive = false
  }

  schema {
    name                = "tenant_id"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 36
      max_length = 36
    }
  }

  lambda_config {
    pre_token_generation_config {
      lambda_arn     = aws_lambda_function.claims.arn
      lambda_version = "V2_0"
    }
  }
}

resource "aws_lambda_permission" "claims" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.claims.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}

resource "aws_cognito_user_pool_client" "api" {
  name         = "meridian-api"
  user_pool_id = aws_cognito_user_pool.main.id

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  generate_secret = false

  access_token_validity = 1
  id_token_validity     = 1
  token_validity_units {
    access_token = "hours"
    id_token     = "hours"
  }
}
