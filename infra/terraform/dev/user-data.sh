#!/bin/bash
set -euxo pipefail
dnf install -y docker
systemctl enable --now docker
mkdir -p /usr/libexec/docker/cli-plugins /opt/meridian
curl -fsSL -o /usr/libexec/docker/cli-plugins/docker-compose \
  https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-aarch64
chmod +x /usr/libexec/docker/cli-plugins/docker-compose
usermod -aG docker ec2-user
