#!/bin/sh
# Fetch the current G4 rotating media key for the external hardware harness.
# The Scrypted plugin never reads this file.
set -eu
umask 077

: "${G4_KEY_SSH_TARGET:?Set G4_KEY_SSH_TARGET to the authorized server SSH target}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
remote_path=${G4_KEY_REMOTE_PATH:-/var/lib/aqara-g4-relayless/runtime/session-key-cache.hex}
remote_sudo=${G4_KEY_REMOTE_SUDO:-0}
local_setting=${G4_KEY_LOCAL_PATH:-private/runtime/g4-session-key.hex}

case "$G4_KEY_SSH_TARGET" in
  -*|'') echo "invalid G4_KEY_SSH_TARGET" >&2; exit 2 ;;
esac
case "$remote_path" in
  /*) ;;
  *) echo "G4_KEY_REMOTE_PATH must be absolute" >&2; exit 2 ;;
esac
case "$remote_path" in
  *[!A-Za-z0-9_./-]*) echo "G4_KEY_REMOTE_PATH contains unsupported characters" >&2; exit 2 ;;
esac
case "$remote_sudo" in
  0|1) ;;
  *) echo "G4_KEY_REMOTE_SUDO must be 0 or 1" >&2; exit 2 ;;
esac

case "$local_setting" in
  /*) local_path=$local_setting ;;
  *) local_path=$project_dir/$local_setting ;;
esac
case "$local_path" in
  "$project_dir"/private/*) ;;
  *) echo "G4_KEY_LOCAL_PATH must remain under $project_dir/private" >&2; exit 2 ;;
esac

local_dir=$(dirname -- "$local_path")
mkdir -p "$local_dir"
chmod 700 "$project_dir/private" "$local_dir"
if [ -L "$local_path" ]; then
  echo "refusing symlink key destination: $local_path" >&2
  exit 2
fi

download=$(mktemp "$local_dir/.g4-key-download.XXXXXX")
normalized=$(mktemp "$local_dir/.g4-key-normalized.XXXXXX")
cleanup() {
  for file in "$download" "$normalized"; do
    if [ -n "$file" ] && [ -e "$file" ]; then
      find "$file" -maxdepth 0 -type f -delete
    fi
  done
}
trap cleanup EXIT HUP INT TERM

ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ClearAllForwardings=yes -T "$G4_KEY_SSH_TARGET" \
  sh -s -- "$remote_path" "$remote_sudo" > "$download" <<'REMOTE_SCRIPT'
set -eu
path=$1
use_sudo=$2
run() {
  if [ "$use_sudo" = 1 ]; then
    sudo -n "$@"
  else
    "$@"
  fi
}
run test -f "$path"
run test ! -L "$path"
mode=$(run stat -c '%a' "$path")
case "$mode" in
  400|600) ;;
  *) echo "remote key permissions are not owner-only" >&2; exit 3 ;;
esac
run cat -- "$path"
REMOTE_SCRIPT

tr -d '\r\n' < "$download" > "$normalized"
if [ "$(wc -c < "$normalized" | tr -d ' ')" -ne 32 ]; then
  echo "fetched key is not 32 hexadecimal characters" >&2
  exit 3
fi
if ! LC_ALL=C grep -Eq '^[0-9A-Fa-f]{32}$' "$normalized"; then
  echo "fetched key contains invalid characters" >&2
  exit 3
fi
chmod 600 "$normalized"
mv -f "$normalized" "$local_path"
normalized=
chmod 600 "$local_path"

fingerprint=$(shasum -a 256 "$local_path" | awk '{print $1}')
printf 'G4 rotating key synchronized: path=%s sha256=%s\n' "$local_path" "$fingerprint"
