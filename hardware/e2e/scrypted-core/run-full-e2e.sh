#!/bin/sh
# Bare native multi-camera Scrypted Core/HomeKit boundary E2E. No containers.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
if [ -n "${GO2RTC_SOURCE_DIR:-}" ]; then
  go2rtc_repo=$GO2RTC_SOURCE_DIR
  test -d "$go2rtc_repo/.git" || { echo "GO2RTC_SOURCE_DIR is not a git checkout: $go2rtc_repo" >&2; exit 2; }
else
  go2rtc_repo=$project_dir/.artifacts/go2rtc-source
fi
go2rtc_bin=$project_dir/.artifacts/go2rtc-e2e/bin/go2rtc-v1.9.14
harness_node=$script_dir/node_modules/.bin/node
ffmpeg_path=$(command -v ffmpeg || true)
ffprobe_path=$(command -v ffprobe || true)
python_path=$(uv python find 3.11 2>/dev/null || true)

for command in curl git go npm sed tar uv; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing command: $command" >&2; exit 2; }
done
test -n "$ffmpeg_path" || { echo 'missing command: ffmpeg' >&2; exit 2; }
test -n "$ffprobe_path" || { echo 'missing command: ffprobe' >&2; exit 2; }
test -n "$python_path" || { echo 'uv could not locate Python 3.11' >&2; exit 2; }
test -x "$harness_node" || {
  echo "install the pinned native harness first: npm ci --prefix $script_dir" >&2
  exit 2
}
for port in 10443 11080 11883 11885 11984 18554; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "required loopback port is already in use: $port" >&2
    exit 2
  fi
done

artifacts=$project_dir/.artifacts/scrypted-core-e2e
mkdir -p "$artifacts"
runtime=$(mktemp -d "$artifacts/run.XXXXXX")
evidence=$runtime/evidence
volume=$runtime/scrypted-volume
mkdir -p "$evidence" "$volume"
chmod 700 "$artifacts" "$runtime" "$evidence" "$volume"

if [ ! -x "$go2rtc_bin" ]; then
  if [ ! -d "$go2rtc_repo/.git" ]; then
    mkdir -p "$go2rtc_repo"
    git -C "$go2rtc_repo" init -q
    git -C "$go2rtc_repo" remote add origin https://github.com/AlexxIT/go2rtc.git
  fi
  if ! git -C "$go2rtc_repo" rev-parse --verify --quiet refs/tags/v1.9.14 >/dev/null; then
    git -C "$go2rtc_repo" fetch --depth=1 origin \
      refs/tags/v1.9.14:refs/tags/v1.9.14
  fi
  mkdir -p "$(dirname -- "$go2rtc_bin")"
  build_dir=$(mktemp -d "$artifacts/go2rtc-build.XXXXXX")
  git -C "$go2rtc_repo" archive v1.9.14 | tar -x -C "$build_dir"
  (cd "$build_dir" && go build -trimpath -o "$go2rtc_bin" .)
  chmod 700 "$go2rtc_bin"
  find "$build_dir" -depth -delete
fi

config=$runtime/go2rtc.yaml
talkback=$runtime/talkback
snapshot=$runtime/snapshot.jpg
tone=$runtime/tone.wav
sed \
  -e "s|@FFMPEG@|$ffmpeg_path|g" \
  -e "s|@TALKBACK_SINK@|$project_dir/hardware/e2e/talkback-sink.sh|g" \
  -e "s|@TALKBACK_OUTPUT@|$talkback|g" \
  "$script_dir/go2rtc.yaml.template" > "$config"
chmod 600 "$config"

"$ffmpeg_path" -hide_banner -loglevel error -y \
  -f lavfi -i testsrc2=size=1280x720:rate=1 -frames:v 1 -q:v 2 "$snapshot"
"$ffmpeg_path" -hide_banner -loglevel error -y \
  -f lavfi -i sine=frequency=880:sample_rate=16000 -t 8 -c:a pcm_s16le "$tone"

fixture_pid=
go2rtc_pid=
scrypted_pid=
cleanup() {
  for pid in "$scrypted_pid" "$go2rtc_pid" "$fixture_pid"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  attempts=0
  while [ "$attempts" -lt 50 ]; do
    alive=false
    for pid in "$scrypted_pid" "$go2rtc_pid" "$fixture_pid"; do
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        alive=true
      fi
    done
    [ "$alive" = false ] && break
    attempts=$((attempts + 1))
    sleep 0.1
  done
  for pid in "$scrypted_pid" "$go2rtc_pid" "$fixture_pid"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
    [ -n "$pid" ] && wait "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT HUP INT TERM

(
  cd "$script_dir"
  E2E_SNAPSHOT_PATH=$snapshot E2E_TONE_PATH=$tone \
    "$harness_node" fixture-services.mjs
) > "$runtime/fixtures.log" 2>&1 &
fixture_pid=$!

"$go2rtc_bin" -config "$config" > "$runtime/go2rtc.log" 2>&1 &
go2rtc_pid=$!

(
  cd "$script_dir"
  SCRYPTED_VOLUME=$volume \
  SCRYPTED_FFMPEG_PATH=$ffmpeg_path \
  SCRYPTED_PYTHON_PATH=$python_path \
  SCRYPTED_INSTALL_PLUGIN=@scrypted/core \
  SCRYPTED_ADMIN_USERNAME=codex-e2e \
  SCRYPTED_ADMIN_ADDRESS=127.0.0.1 \
  SCRYPTED_INSECURE_PORT=11080 \
  SCRYPTED_SECURE_PORT=10443 \
  SCRYPTED_DEBUG_PORT=10081 \
    "$harness_node" --expose-gc ./node_modules/@scrypted/server/dist/scrypted-main.js
) > "$runtime/scrypted.log" 2>&1 &
scrypted_pid=$!

wait_http() {
  name=$1
  url=$2
  attempts=0
  until curl --noproxy '*' -fsS --max-time 2 -o /dev/null "$url" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 240 ]; then
      echo "$name did not become ready: $url" >&2
      return 1
    fi
    sleep 0.25
  done
}

wait_http fixtures http://127.0.0.1:11885/health
wait_http go2rtc http://127.0.0.1:11984/api
wait_http Scrypted http://127.0.0.1:11080/

for plugin in homekit webrtc snapshot prebuffer-mixin diagnostics; do
  curl --noproxy '*' --fail --silent --show-error --max-time 180 \
    -X POST "http://127.0.0.1:11080/web/component/script/install/@scrypted/$plugin" \
    > "$runtime/install-$plugin.json"
done

(cd "$project_dir" && npm run build > "$runtime/plugin-build.log" 2>&1)
curl --noproxy '*' --fail --silent --show-error --max-time 30 \
  -X POST -H 'Content-Type: application/json' --data-binary "@$project_dir/package.json" \
  'http://127.0.0.1:11080/web/component/script/setup?npmPackage=@johnnybyzhang%2Fscrypted-frigate' \
  > "$runtime/plugin-setup.txt"
curl --noproxy '*' --fail --silent --show-error --max-time 180 \
  -X POST -H 'Content-Type: application/zip' --data-binary "@$project_dir/out/plugin.zip" \
  'http://127.0.0.1:11080/web/component/script/deploy?npmPackage=@johnnybyzhang%2Fscrypted-frigate' \
  > "$runtime/plugin-deploy.txt"

(
  cd "$script_dir"
  SCRYPTED_E2E_URL=https://127.0.0.1:10443 \
  SCRYPTED_E2E_LAYOUT_EVIDENCE=$evidence/settings-layout.json \
    "$harness_node" configure-runtime.mjs
) > "$runtime/configure.log"
(
  cd "$script_dir"
  SCRYPTED_E2E_URL=https://127.0.0.1:10443 \
  SCRYPTED_E2E_EVIDENCE=$evidence/runtime.json \
    "$harness_node" verify-runtime.mjs
) > "$runtime/verify.log"

runtime_json=$evidence/runtime.json
front_main=$($harness_node -p "require('$runtime_json').rebroadcast.frontDoor.main")
front_sub=$($harness_node -p "require('$runtime_json').rebroadcast.frontDoor.sub")
side_main=$($harness_node -p "require('$runtime_json').rebroadcast.sideYard.main")
side_sub=$($harness_node -p "require('$runtime_json').rebroadcast.sideYard.sub")

"$ffprobe_path" -v error -rtsp_transport tcp -read_intervals '%+3' -show_streams -of json "$front_main" > "$evidence/rebroadcast-front-main.json"
"$ffprobe_path" -v error -rtsp_transport tcp -read_intervals '%+3' -show_streams -of json "$front_sub" > "$evidence/rebroadcast-front-sub.json"
"$ffprobe_path" -v error -rtsp_transport tcp -read_intervals '%+3' -show_streams -of json "$side_main" > "$evidence/rebroadcast-side-main.json"
"$ffprobe_path" -v error -rtsp_transport tcp -read_intervals '%+3' -show_streams -of json "$side_sub" > "$evidence/rebroadcast-side-sub.json"

test -s "$talkback.alaw"
"$ffmpeg_path" -hide_banner -loglevel error -y \
  -f alaw -ar 8000 -ac 1 -i "$talkback.alaw" "$evidence/talkback.wav"
"$ffprobe_path" -v error -show_streams -show_format -of json \
  "$evidence/talkback.wav" > "$evidence/talkback.json"

printf '%s\n' "$runtime" > "$artifacts/latest-run.txt"
printf 'Scrypted Core/HomeKit boundary E2E: PASS\n'
printf '  two cameras: API discovery, checkbox remove/re-add, stable ids\n'
printf '  media: Scrypted source paths, snapshots, Rebroadcast main/sub probes\n'
printf '  events: derived Frigate motion/audio plus doorbell/tamper MQTT\n'
printf '  talkback: Scrypted Intercom -> go2rtc -> PCMA sink\n'
printf '  HomeKit: plugin loaded, camera mixins active, standalone accessories configured\n'
printf '  artifacts: %s\n' "$runtime"
