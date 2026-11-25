#!/bin/sh
# Read-only checks before bootstrap. This script does not apply Terraform.
set -eu

missing=0
need() {
  echo "missing: $1"
  missing=1
}

echo "Meridian AWS preflight (no resources are created)"

if command -v terraform >/dev/null 2>&1; then
  terraform version | head -n 1
else
  need "terraform. Install: brew tap hashicorp/tap && brew install hashicorp/tap/terraform"
fi

if command -v aws >/dev/null 2>&1; then
  aws --version
else
  need "aws. Install: brew install awscli"
fi

if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    echo "gh: authenticated"
  else
    need "gh auth. Run: gh auth login"
  fi
else
  need "gh. Install: brew install gh"
fi

if command -v aws >/dev/null 2>&1; then
  if identity="$(aws sts get-caller-identity --output text 2>/dev/null)"; then
    echo "aws identity: $identity"
    region="$(aws configure get region || true)"
    echo "aws region: ${region:-unset}"
    if [ "$region" != "us-east-1" ]; then
      echo "set the CLI region to us-east-1 before bootstrap: aws configure set region us-east-1"
      missing=1
    fi
  else
    need "AWS credentials. Run: aws configure, then aws sts get-caller-identity"
  fi
fi

if [ -f infra/terraform/bootstrap/terraform.tfvars ]; then
  echo "bootstrap tfvars: present"
else
  echo "next: cp infra/terraform/bootstrap/terraform.tfvars.example infra/terraform/bootstrap/terraform.tfvars"
  echo "then set budget_email. Do not commit that file."
  missing=1
fi

if [ "$missing" -ne 0 ]; then
  echo "preflight failed"
  exit 1
fi

echo "preflight passed. Bootstrap is still a manual apply. See docs/runbooks/dev-stack.md"
