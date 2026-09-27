#!/usr/bin/env sh
set -eu

# Runs on a new instance launched from the captured base. Packer reaches this script only after
# cloud-init injected the verification build's own key pair, so a successful connection is the
# new-key check. The script then checks the base contract and records boot evidence.
expected_architecture=${SHIPFOX_RUNNER_BASE_ARCHITECTURE:?SHIPFOX_RUNNER_BASE_ARCHITECTURE is required}
expected_node_version=${SHIPFOX_RUNNER_BASE_NODE_VERSION:?SHIPFOX_RUNNER_BASE_NODE_VERSION is required}
root_dir=${RUNNER_BASE_ROOT:-/}

fail() {
  printf 'runner base verification (%s): %s\n' "$expected_architecture" "$*" >&2
  exit 1
}

# Exit status 2 reports a completed run with recoverable warnings, which Canonical sources can emit.
cloud_init_status=$(cloud-init status --wait) || [ "$?" -eq 2 ] || fail 'cloud-init failed'
case "$cloud_init_status" in
  *'status: done'*) ;;
  *) fail "cloud-init did not finish: $cloud_init_status" ;;
esac

architecture=$(dpkg --print-architecture)
[ "$architecture" = "$expected_architecture" ] ||
  fail "architecture is $architecture, expected $expected_architecture"

grep -qx 'VERSION_CODENAME=noble' "$root_dir/etc/os-release" ||
  fail 'the base is not Ubuntu 24.04 (noble)'

grep -Eqx '[0-9a-f]{32}' "$root_dir/etc/machine-id" ||
  fail 'machine-id was not generated for this instance'
[ -n "$(find "$root_dir/etc/ssh" -maxdepth 1 -type f -name 'ssh_host_*_key' -print -quit)" ] ||
  fail 'SSH host keys were not generated for this instance'

package_state() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null || true
}

# Keep this list aligned with the packages installed by prepare-os.sh.
for package in \
  ca-certificates curl wget git openssh-client tar gzip xz-utils bzip2 zip unzip jq \
  build-essential cloud-guest-utils python3 pkg-config ripgrep fd-find sudo amazon-ec2-utils \
  ec2-instance-connect cloud-init; do
  [ "$(package_state "$package")" = 'install ok installed' ] ||
    fail "required package is missing: $package"
done

for package in snapd amazon-ssm-agent; do
  if [ "$(package_state "$package")" = 'install ok installed' ]; then
    fail "forbidden package remains installed: $package"
  fi
done
if command -v snap >/dev/null 2>&1; then
  fail 'snap remains available'
fi

node_version=$(node --version 2>/dev/null || true)
[ "$node_version" = "v$expected_node_version" ] ||
  fail "Node is ${node_version:-missing}, expected v$expected_node_version"

# The base carries no Shipfox runtime. The runner image stage owns all of it.
if id shipfox >/dev/null 2>&1; then
  fail 'the shipfox user exists in the base'
fi
for shipfox_path in opt/runner opt/shipfox-runner etc/shipfox; do
  [ ! -e "$root_dir/$shipfox_path" ] || fail "Shipfox runtime path exists in the base: $shipfox_path"
done

printf 'runner base kernel: %s\n' "$(uname -r)"
printf 'runner base boot timing: %s\n' "$(systemd-analyze time 2>/dev/null || echo unavailable)"
df -h /
printf 'runner base verified: ubuntu24/%s\n' "$expected_architecture"
