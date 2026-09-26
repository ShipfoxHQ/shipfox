#!/usr/bin/env sh
set -eu

# Return the captured base to the first-boot state of its Canonical source, so every instance
# launched from it runs cloud-init as a new instance: new machine identity, new SSH host keys,
# and the launch key pair injected into the default user.
root_dir=${RUNNER_BASE_ROOT:-/}

cloud-init clean --logs
# An empty machine-id matches the Canonical source image. systemd generates a new one at boot.
truncate -s 0 "$root_dir/etc/machine-id"
rm -f "$root_dir/etc/hostname"
rm -f "$root_dir"/etc/ssh/ssh_host_*
# Packer's temporary key reaches both the default user and root's refusal message.
rm -f "$root_dir/home/ubuntu/.ssh/authorized_keys" "$root_dir/root/.ssh/authorized_keys"

fail() {
  printf 'runner base identity cleanup: %s\n' "$*" >&2
  exit 1
}

[ ! -s "$root_dir/etc/machine-id" ] || fail 'machine-id is not empty'
[ ! -e "$root_dir/etc/hostname" ] || fail 'hostname remains'
[ -z "$(find "$root_dir/etc/ssh" -maxdepth 1 -type f -name 'ssh_host_*' -print -quit)" ] ||
  fail 'SSH host keys remain'
for authorized_keys in \
  "$root_dir/home/ubuntu/.ssh/authorized_keys" \
  "$root_dir/root/.ssh/authorized_keys"; do
  [ ! -e "$authorized_keys" ] || fail "temporary authorized keys remain: $authorized_keys"
done
[ ! -e "$root_dir/var/lib/cloud/instance" ] || fail 'cloud-init instance state remains'
