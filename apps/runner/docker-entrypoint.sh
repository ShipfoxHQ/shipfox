#!/bin/sh
set -eu

# Keep the runner a poor OOM target, as the EC2 image's systemd unit does. Lowering the score
# needs CAP_SYS_RESOURCE, which Docker does not grant by default, so without it the runner keeps
# the container's score.
sudo -n sh -c "echo -900 > /proc/$$/oom_score_adj" 2>/dev/null || true

exec "$@"
