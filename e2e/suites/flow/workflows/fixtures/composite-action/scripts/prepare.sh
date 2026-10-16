#!/bin/sh
# Runs from the action directory the runner unpacked, so it proves `action.path` resolved.
set -eu
if [ -f .composite-check-failed-once ]; then
  echo "prepare rerun after restart"
else
  echo "prepare first pass"
fi
echo "prepare ran $(basename "$0") from the action directory"
