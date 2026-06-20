#!/bin/sh
# Rewrite the client's runtime config from environment variables before nginx
# starts, so one prebuilt image serves any deployment without a rebuild. The
# stock nginx entrypoint runs every executable script in /docker-entrypoint.d/.
set -eu

config_file="/usr/share/nginx/html/config.js"

# SHIPFOX_API_URL is the base URL of the Shipfox API the browser talks to (for
# example https://api.example.com). Empty keeps same-origin relative requests.
cat > "$config_file" <<EOF
window.__SHIPFOX_CONFIG__ = {
  apiUrl: "${SHIPFOX_API_URL:-}"
};
EOF

echo "shipfox: wrote $config_file (apiUrl=\"${SHIPFOX_API_URL:-}\")"
