#!/usr/bin/env sh
set -eu

spot_interruption_action() {
  printf '%s' "$1" | jq -r '.action // empty' 2>/dev/null || true
}

imds_token() {
  curl --silent --show-error --fail --connect-timeout 1 --max-time 2 \
    -X PUT http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600'
}

main() {
  . /opt/shipfox-runner/scripts/runtime/helpers/logger.sh

  while true; do
    token="$(imds_token || true)"
    if [ -n "$token" ]; then
      notice="$(curl --silent --show-error --fail --connect-timeout 1 --max-time 2 \
        -H "X-aws-ec2-metadata-token: $token" \
        http://169.254.169.254/latest/meta-data/spot/instance-action || true)"
      action="$(spot_interruption_action "$notice")"
      case "$action" in
        stop|terminate|hibernate)
          log 'Spot interruption notice received; draining runner before shutdown'
          systemctl stop shipfox-runner.service || true
          sleep 15
          systemctl poweroff --force
          exit 0
          ;;
      esac
    fi
    sleep 5
  done
}

if [ "${SHIPFOX_SPOT_WATCHDOG_LIBRARY:-}" != '1' ]; then
  main
fi
