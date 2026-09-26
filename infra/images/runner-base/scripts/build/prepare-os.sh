#!/usr/bin/env sh
set -eu

# Reusable Ubuntu preparation shared by runner-base bakes and complete runner image bakes.
# It leaves cloud-init, SSH, and the source image's network configuration in place so an image
# built from this stage still accepts a new instance's key and network. Node, Shipfox software,
# and the final boot, network, and hardening policy belong to the runner image stage.
root_dir=${RUNNER_BASE_ROOT:-/}

apt-get update
apt-get install --yes --no-install-recommends \
  ca-certificates curl wget git openssh-client tar gzip xz-utils bzip2 zip unzip jq \
  build-essential cloud-guest-utils python3 pkg-config ripgrep fd-find sudo amazon-ec2-utils \
  ec2-instance-connect

# Runner instances have no host-management credentials. Remove snapd and its seeded
# snaps, including the bundled SSM agent, instead of carrying a failed host-management
# path into every boot.
# Stop snapd before unmounting its seeded loop-backed squashfs filesystems. The base
# image can have these mounts live even after the snapd package is purged.
systemctl stop snapd.seeded.service snapd.service snapd.socket 2>/dev/null || true
for snap_mount in "$root_dir"/snap/* "$root_dir/snap"; do
  if [ -e "$snap_mount" ]; then
    umount "$snap_mount" 2>/dev/null || umount -l "$snap_mount" 2>/dev/null || true
  fi
done
apt-get purge --yes snapd
rm -rf "$root_dir/var/lib/snapd" "$root_dir/snap"

if command -v snap >/dev/null 2>&1 || command -v snapd >/dev/null 2>&1; then
  printf '%s\n' 'runner base setup: snap or snapd is still available after purge' >&2
  exit 1
fi

for removed_path in \
  "$root_dir/var/lib/snapd" \
  "$root_dir/snap" \
  "$root_dir/usr/bin/snap" \
  "$root_dir/usr/lib/snapd/snapd" \
  "$root_dir/lib/systemd/system/snapd.service" \
  "$root_dir/lib/systemd/system/snapd.seeded.service"; do
  if [ -e "$removed_path" ]; then
    printf 'runner base setup: removed snap path still exists: %s\n' "$removed_path" >&2
    exit 1
  fi
done

apt-get clean
rm -rf "$root_dir/var/lib/apt/lists/"*

ln -sf "$(command -v fdfind)" "$root_dir/usr/local/bin/fd"
printf '%s\n' 'LANG=C.UTF-8' > "$root_dir/etc/default/locale"
