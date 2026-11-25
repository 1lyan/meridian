terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.6"
    }
  }

  backend "s3" {
    key     = "dev/terraform.tfstate"
    encrypt = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project = "meridian"
      Stack   = "dev"
    }
  }
}
