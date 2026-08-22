#!/bin/sh
# Read-only G4 hardware preflight. It never starts or changes a media source.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
local_setting=${G4_KEY_LOCAL_PATH:-private/runtime/g4-session-key.hex}
case "$local_setting" in
  /*) key_path=$local_setting ;;
  *) key_path=$project_dir/$local_setting ;;
esac
case "$key_path" in
  "$project_dir"/private/*) ;;
  *) echo "G4 key must remain under $project_dir/private" >&2; exit 2 ;;
esac

test -f "$key_path"
test ! -L "$key_path"
mode=$(stat -f '%Lp' "$key_path" 2>/dev/null || stat -c '%a' "$key_path")
case "$mode" in
  600|400) ;;
  *) echo "local G4 key permissions must be 0600 or 0400" >&2; exit 3 ;;
esac
if [ "$(tr -d '\r\n' < "$key_path" | wc -c | tr -d ' ')" -ne 32 ]; then
  echo "local G4 key is not 32 hexadecimal characters" >&2
  exit 3
fi
if ! tr -d '\r\n' < "$key_path" | LC_ALL=C grep -Eq '^[0-9A-Fa-f]{32}$'; then
  echo "local G4 key contains invalid characters" >&2
  exit 3
fi
printf 'key: ok sha256=%s\n' "$(shasum -a 256 "$key_path" | awk '{print $1}')"

if [ -n "${FRIGATE_BASE_URL:-}" ]; then
  auth_header=
  if [ -n "${FRIGATE_API_TOKEN:-}" ]; then
    auth_header="Authorization: Bearer $FRIGATE_API_TOKEN"
  fi
  if [ -n "$auth_header" ]; then
    curl -fsS --max-time 5 -H "$auth_header" -o /dev/null "${FRIGATE_BASE_URL%/}/api/version"
  else
    curl -fsS --max-time 5 -o /dev/null "${FRIGATE_BASE_URL%/}/api/version"
  fi
  printf 'frigate API: ok\n'
fi

if [ -n "${GO2RTC_API_URL:-}" ]; then
  stream_name=${GO2RTC_STREAM_NAME:-Aqara-G4}
  stream_query=$(printf '%s' "$stream_name" | sed 's/ /%20/g')
  curl -fsS --max-time 5 -o /dev/null "${GO2RTC_API_URL%/}/api/streams?src=$stream_query"
  printf 'go2rtc stream: ok name=%s\n' "$stream_name"
fi

if [ -n "${MQTT_URL:-}" ]; then
  if ! command -v mosquitto_sub >/dev/null 2>&1; then
    echo "mosquitto_sub is required when MQTT_URL is set" >&2
    exit 4
  fi
  mqtt_topic="${G4_MQTT_PREFIX:-aqara/g4}/availability"
  set -- -W 5 -C 1 -t "$mqtt_topic"
  if [ -n "${MQTT_USERNAME:-}" ]; then
    set -- "$@" -u "$MQTT_USERNAME"
  fi
  if [ -n "${MQTT_PASSWORD:-}" ]; then
    set -- "$@" -P "$MQTT_PASSWORD"
  fi
  mosquitto_sub -L "$MQTT_URL" "$@" >/dev/null
  printf 'G4 MQTT availability: ok topic=%s\n' "$mqtt_topic"
fi

printf 'G4 hardware preflight: PASS (read-only; no source was started)\n'
