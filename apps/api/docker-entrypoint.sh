#!/bin/sh
set -eu

if [ "${1:-}" = "node" ] && [ -n "${SHIPFOX_ENV_FILE:-}" ]; then
  shift
  set -- node "--env-file=$SHIPFOX_ENV_FILE" "$@"
fi

exec "$@"
