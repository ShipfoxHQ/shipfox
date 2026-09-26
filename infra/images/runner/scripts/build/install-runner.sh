#!/usr/bin/env sh
set -eu

root_dir=${RUNNER_IMAGE_ROOT:-/}
runner_dir=${RUNNER_IMAGE_RUNNER_DIR:-/opt/runner}
workspace="$root_dir/tmp/shipfox-runner-workspace"
store_dir="$root_dir/tmp/shipfox-runner-pnpm-store"
lockfile="$(find "$workspace" -name pnpm-lock.yaml -print -quit)"
if [ -z "$lockfile" ]; then
  echo 'Pruned runner workspace has no pnpm lockfile.' >&2
  exit 1
fi
cd "$(dirname "$lockfile")"
corepack prepare pnpm@11.7.0 --activate
# Stage the package store with the workspace so the cleanup below removes it instead of
# leaving the development dependency tree in every snapshot.
pnpm install --frozen-lockfile --store-dir "$store_dir"
pnpm --filter=@shipfox/runner deploy --prod --legacy --config.strict-peer-dependencies=false \
  --store-dir "$store_dir" "$runner_dir"
# Verify the deployed production closure contains every Pi extension entry, the renewable
# credential helpers, and the bundled Claude Code binary before the image is published. This runs
# against the deployed flat layout, not the pnpm development tree.
node "$runner_dir/dist/verify-installation.js"
# The runner package is the deployed root rather than an installed dependency, so its package bin
# is not linked onto PATH by pnpm. Keep Git's name-based helper resolution usable in production.
mkdir -p "$root_dir/usr/local/bin"
ln -sfn "$runner_dir/dist/git-credential-helper.js" \
  "$root_dir/usr/local/bin/git-credential-shipfox"
chown -R shipfox:shipfox "$runner_dir"

# Ubuntu's tmpfiles.d/tmp.conf applies `D /tmp 1777 root root 30d` during boot.
# Remove the dependency tree before the AMI is snapshotted so tmpfiles does not
# recursively walk the build staging area on every runner start.
rm -rf "$workspace" "$store_dir"
for staged_path in "$workspace" "$store_dir"; do
  if [ -e "$staged_path" ]; then
    echo "Runner image staging path remains after cleanup: $staged_path" >&2
    exit 1
  fi
done
