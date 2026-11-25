locals {
  log_groups = [
    "/meridian/api",
    "/meridian/worker",
    "/meridian/agent",
    "/meridian/edge",
    "/meridian/rabbitmq",
    "/meridian/redis",
    "/meridian/xray",
  ]
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(local.log_groups)
  name              = each.key
  retention_in_days = 7
}
