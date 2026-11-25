resource "aws_iam_role" "instance" {
  name = "meridian-instance"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "instance" {
  statement {
    sid = "Parameters"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/meridian/dev/*"]
  }

  statement {
    sid = "Artifacts"
    actions = [
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.artifacts.arn,
      "${aws_s3_bucket.artifacts.arn}/*",
    ]
  }

  statement {
    sid       = "Images"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "Pull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
    resources = [for repo in aws_ecr_repository.app : repo.arn]
  }

  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = [
      "arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/meridian/*",
      "arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/meridian/*:*",
    ]
  }

  statement {
    sid = "XRay"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "instance" {
  name   = "meridian-instance"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "meridian-instance"
  role = aws_iam_role.instance.name
}
