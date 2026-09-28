#!/usr/bin/env sh
set -eu

# Runner bases install the latest release of this Node major, so each base generation picks up
# Node patch releases. Candidates built from a base keep its Node, skip the download, and keep
# /usr/local out of their snapshot. Complete runner image builds run the same script.
# Keep verify-instance.sh aligned with this major.
node_major=24
root_dir=${RUNNER_BASE_ROOT:-/}
architecture="$(dpkg --print-architecture)"
case "$architecture" in
  amd64) node_arch=x64 ;;
  arm64) node_arch=arm64 ;;
  *) echo "Unsupported architecture: $architecture" >&2; exit 1 ;;
esac

case "$(node --version 2>/dev/null || true)" in
  "v${node_major}."*) ;;
  *)
    release_url="https://nodejs.org/dist/latest-v${node_major}.x"
    node_version=$(
      curl --fail --silent --show-error --location --retry 3 "$release_url/SHASUMS256.txt" |
        sed -n "s/^[0-9a-f]*  node-\(v${node_major}\.[0-9]*\.[0-9]*\)-linux-${node_arch}\.tar\.xz\$/\1/p"
    )
    if [ -z "$node_version" ]; then
      echo "No Node ${node_major} release found for linux-${node_arch}" >&2
      exit 1
    fi
    archive="$root_dir/tmp/node-${node_version}-linux-${node_arch}.tar.xz"
    curl --fail --location --retry 3 \
      "$release_url/node-${node_version}-linux-${node_arch}.tar.xz" \
      -o "$archive"
    tar --extract --xz --file "$archive" --strip-components=1 --directory "$root_dir/usr/local"
    rm "$archive"
    ;;
esac
corepack enable
