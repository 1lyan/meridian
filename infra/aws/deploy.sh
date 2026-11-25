#!/bin/sh
# Runs on the EC2 instance via SSM. The GitHub workflow has already pushed
# images and uploaded this directory to the artifact bucket.
set -eu

tag="${1:?image tag}"
region="${AWS_REGION:-us-east-1}"
prefix="/meridian/dev"

param() {
  aws ssm get-parameter --region "$region" --name "$1" --with-decryption --query Parameter.Value --output text
}

mongo_url="$(param "$prefix/mongo_url")"
if [ -z "$mongo_url" ] || [ "$mongo_url" = "unset" ]; then
  echo "MONGO_URL is unset. Create an Atlas M0 cluster, allow this instance's Elastic IP, and put the connection string in SSM $prefix/mongo_url. Then run dev-apply again."
  exit 1
fi

cat > /opt/meridian/.env <<EOF
AWS_REGION=$region
IMAGE_TAG=$tag
ECR_REGISTRY=$(param "$prefix/ecr_registry")
DATABASE_URL=$(param "$prefix/database_url")
MONGO_URL=$mongo_url
IDENTITY_ISSUER=$(param "$prefix/identity_issuer")
IDENTITY_AUDIENCE=$(param "$prefix/identity_audience")
EOF

registry="$(param "$prefix/ecr_registry")"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry"

cd /opt/meridian
docker compose --env-file .env -f docker-compose.yml pull
docker compose --env-file .env -f docker-compose.yml up -d
docker compose --env-file .env -f docker-compose.yml ps
