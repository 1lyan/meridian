locals {
  repositories = ["meridian-api", "meridian-worker", "meridian-agent", "meridian-edge"]
}

resource "aws_ecr_repository" "app" {
  for_each     = toset(local.repositories)
  name         = each.key
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}
