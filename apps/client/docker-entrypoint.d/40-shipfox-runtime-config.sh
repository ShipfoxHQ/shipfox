#!/bin/sh
# Rewrite the client's runtime config from environment variables before nginx
# starts, so one prebuilt image serves any deployment without a rebuild.
#
# Every SHIPFOX_PUBLIC_* variable becomes a key in window.__SHIPFOX_CONFIG__ with
# the prefix stripped (SHIPFOX_PUBLIC_API_URL -> "API_URL"), which the client
# maps back to its config schema. Adding a config key therefore needs no change
# here. Values are assumed single-line (URLs, ids, tokens).
#
# The stock nginx entrypoint runs every executable script in /docker-entrypoint.d/.
set -eu

config_file="/usr/share/nginx/html/config.js"

{
  printf 'window.__SHIPFOX_CONFIG__ = {\n'
  first=1
  for name in $(awk 'BEGIN { for (v in ENVIRON) if (v ~ /^SHIPFOX_PUBLIC_/) print v }'); do
    key=${name#SHIPFOX_PUBLIC_}
    value=$(printenv "$name" || printf '')
    # Escape backslashes then double quotes for a JS string literal.
    escaped=$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g')
    [ "$first" -eq 1 ] || printf ',\n'
    printf '  "%s": "%s"' "$key" "$escaped"
    first=0
  done
  printf '\n};\n'
} > "$config_file"

echo "shipfox: wrote $config_file from SHIPFOX_PUBLIC_* environment"
