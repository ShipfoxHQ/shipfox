#!/usr/bin/env sh
set -eu

: "${NODE_VERSION:?NODE_VERSION is required}"
architecture="$(dpkg --print-architecture)"
case "$architecture" in
  amd64) node_arch=x64 ;;
  arm64) node_arch=arm64 ;;
  *) echo "Unsupported architecture: $architecture" >&2; exit 1 ;;
esac

archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
curl --fail --location --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/${archive}" -o "/tmp/${archive}"
tar --extract --xz --file "/tmp/${archive}" --strip-components=1 --directory /usr/local
rm "/tmp/${archive}"
corepack enable
