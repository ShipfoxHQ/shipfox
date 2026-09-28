#!/usr/bin/env sh
set -eu

# Docker Engine, Buildx, and Compose come from Docker's apt repository rather than Ubuntu's
# docker.io, so each base generation bakes the latest stable release. Complete runner image
# builds run the same script after the OS preparation.
root_dir=${RUNNER_BASE_ROOT:-/}

install -d -m 0755 "$root_dir/etc/apt/keyrings"
curl --fail --silent --show-error --location --retry 3 \
  https://download.docker.com/linux/ubuntu/gpg -o "$root_dir/etc/apt/keyrings/docker.asc"
chmod a+r "$root_dir/etc/apt/keyrings/docker.asc"
ubuntu_codename=$(. "$root_dir/etc/os-release" && printf '%s' "$VERSION_CODENAME")
cat > "$root_dir/etc/apt/sources.list.d/docker.sources" <<SOURCES
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $ubuntu_codename
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES

apt-get update
apt-get install --yes --no-install-recommends \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

apt-get clean
rm -rf "$root_dir/var/lib/apt/lists/"*
