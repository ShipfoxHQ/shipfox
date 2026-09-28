#!/usr/bin/env sh
set -eu

# Runs after @shipfox/runner-base's prepare-os.sh, which owns the OS packages and snapd removal.
root_dir=${RUNNER_IMAGE_ROOT:-/}

# Keep a disk-backed memory reserve available while jobs run.
swapfile="$root_dir/swapfile"
fallocate -l 4G "$swapfile"
chmod 600 "$swapfile"
mkswap "$swapfile"
swapon "$swapfile"
printf '%s\n' '/swapfile none swap sw 0 0' >> "$root_dir/etc/fstab"

# The final image reads its one user-data payload directly from IMDSv2. Keep cloud-init
# only long enough for Packer's initial NoCloud SSH bootstrap, then remove its package and state.
apt-get purge --yes cloud-init
rm -rf "$root_dir/etc/cloud"
# The purge can rebuild apt's package caches after the OS stage cleaned them.
apt-get clean

groupadd --system shipfox || true
id shipfox >/dev/null 2>&1 || useradd --system --gid shipfox --create-home --home-dir /home/shipfox shipfox
# Jobs run as shipfox and reach the base's Docker daemon without sudo.
usermod --append --groups docker shipfox
printf '%s\n' 'shipfox ALL=(ALL) NOPASSWD:ALL' > "$root_dir/etc/sudoers.d/shipfox"
chmod 0440 "$root_dir/etc/sudoers.d/shipfox"
install -d -o shipfox -g shipfox "$root_dir/opt/runner"
