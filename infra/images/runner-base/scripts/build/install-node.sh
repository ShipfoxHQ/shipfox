#!/usr/bin/env sh
set -eu

# Runner bases install the pinned Node, so candidates built from a base skip the download and
# keep /usr/local out of their snapshot. Complete runner image builds run the same script.
: "${NODE_VERSION:?NODE_VERSION is required}"
root_dir=${RUNNER_BASE_ROOT:-/}
architecture="$(dpkg --print-architecture)"
case "$architecture" in
  amd64) node_arch=x64 ;;
  arm64) node_arch=arm64 ;;
  *) echo "Unsupported architecture: $architecture" >&2; exit 1 ;;
esac

if [ "$(node --version 2>/dev/null || true)" != "v${NODE_VERSION}" ]; then
  archive="$root_dir/tmp/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
  curl --fail --location --retry 3 \
    "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    -o "$archive"
  tar --extract --xz --file "$archive" --strip-components=1 --directory "$root_dir/usr/local"
  rm "$archive"
fi
corepack enable
