resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_oidc_subject}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "apply" {
  name               = "meridian-github-apply"
  assume_role_policy = data.aws_iam_policy_document.github_trust.json
}

data "aws_iam_policy_document" "apply" {
  statement {
    sid       = "State"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
  }

  statement {
    sid = "Lock"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
    ]
    resources = [aws_dynamodb_table.lock.arn]
  }

  # Terraform creates the dev network, databases, and instance roles.
  # The trust policy is the real boundary: only main on this repository.
  statement {
    sid       = "DevStack"
    actions   = ["*"]
    resources = ["*"]
  }

  statement {
    sid    = "RefuseIdleSpend"
    effect = "Deny"
    actions = [
      "ec2:CreateNatGateway",
      "elasticache:*",
      "es:*",
      "kafka:*",
      "mq:*",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "apply" {
  name   = "meridian-github-apply"
  role   = aws_iam_role.apply.id
  policy = data.aws_iam_policy_document.apply.json
}

resource "aws_iam_role" "nightly" {
  name               = "meridian-github-nightly"
  assume_role_policy = data.aws_iam_policy_document.github_trust.json
}

data "aws_iam_policy_document" "nightly" {
  statement {
    sid     = "BedrockNovaMicro"
    actions = ["bedrock:InvokeModel"]
    resources = [
      "arn:aws:bedrock:${var.region}::foundation-model/amazon.nova-micro-v1:0",
    ]
  }
}

resource "aws_iam_role_policy" "nightly" {
  name   = "meridian-github-nightly"
  role   = aws_iam_role.nightly.id
  policy = data.aws_iam_policy_document.nightly.json
}
