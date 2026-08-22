#!/bin/sh
# Bare native go2rtc media and intercom E2E.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
if [ -n "${GO2RTC_SOURCE_DIR:-}" ]; then
  go2rtc_repo=$GO2RTC_SOURCE_DIR
  test -d "$go2rtc_repo/.git" || { echo "GO2RTC_SOURCE_DIR is not a git checkout: $go2rtc_repo" >&2; exit 2; }
else
  go2rtc_repo=$project_dir/.artifacts/go2rtc-source
fi
go2rtc_version=${GO2RTC_E2E_VERSION:-v1.9.10}
case "$go2rtc_version" in
  v1.9.10|v1.9.14) ;;
  *) echo "GO2RTC_E2E_VERSION must be v1.9.10 or v1.9.14" >&2; exit 2 ;;
esac
artifacts=$project_dir/.artifacts/go2rtc-e2e
bin_dir=$artifacts/bin
runtime_dir=$artifacts/runtime/$go2rtc_version
go2rtc_bin=$bin_dir/go2rtc-$go2rtc_version
config=$runtime_dir/go2rtc.yaml
talkback_base=$runtime_dir/talkback
tone=$runtime_dir/tone.wav
log=$runtime_dir/go2rtc.log

for command in ffmpeg ffprobe go git tar curl npm; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing command: $command" >&2; exit 2; }
done
mkdir -p "$bin_dir" "$runtime_dir"
chmod 700 "$artifacts" "$bin_dir" "$runtime_dir"

if [ ! -x "$go2rtc_bin" ]; then
  if [ ! -d "$go2rtc_repo/.git" ]; then
    mkdir -p "$go2rtc_repo"
    git -C "$go2rtc_repo" init -q
    git -C "$go2rtc_repo" remote add origin https://github.com/AlexxIT/go2rtc.git
  fi
  if ! git -C "$go2rtc_repo" rev-parse --verify --quiet "refs/tags/$go2rtc_version" >/dev/null; then
    git -C "$go2rtc_repo" fetch --depth=1 origin \
      "refs/tags/$go2rtc_version:refs/tags/$go2rtc_version"
  fi
  build_dir=$(mktemp -d "$artifacts/build.XXXXXX")
  cleanup_build() {
    if [ -d "$build_dir" ]; then
      find "$build_dir" -depth -delete
    fi
  }
  trap cleanup_build EXIT HUP INT TERM
  git -C "$go2rtc_repo" archive "$go2rtc_version" | tar -x -C "$build_dir"
  (cd "$build_dir" && go build -trimpath -o "$go2rtc_bin" .)
  chmod 700 "$go2rtc_bin"
  cleanup_build
  trap - EXIT HUP INT TERM
fi

ffmpeg_path=$(command -v ffmpeg)
sink_path=$script_dir/talkback-sink.sh
sed \
  -e "s|@FFMPEG@|$ffmpeg_path|g" \
  -e "s|@TALKBACK_SINK@|$sink_path|g" \
  -e "s|@TALKBACK_OUTPUT@|$talkback_base|g" \
  "$script_dir/go2rtc.yaml.template" > "$config"
chmod 600 "$config"

find "$runtime_dir" -maxdepth 1 -type f \( -name 'talkback.*' -o -name '.talkback.*' -o -name 'tone.wav' -o -name 'go2rtc.log' \) -delete
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i sine=frequency=880:sample_rate=16000:duration=10 \
  -c:a pcm_alaw -ar 8000 -ac 1 "$tone"

"$go2rtc_bin" -config "$config" > "$log" 2>&1 &
go2rtc_pid=$!
cleanup_runtime() {
  if kill -0 "$go2rtc_pid" 2>/dev/null; then
    kill -TERM "$go2rtc_pid" 2>/dev/null || true
    wait "$go2rtc_pid" 2>/dev/null || true
  fi
}
trap cleanup_runtime EXIT HUP INT TERM

attempt=0
until curl -fsS --max-time 1 -o /dev/null http://127.0.0.1:11984/api 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ]; then
    echo "go2rtc did not become ready; see $log" >&2
    exit 3
  fi
  sleep 0.1
done

probe=$runtime_dir/probe.txt
ffprobe -v error -rtsp_transport tcp \
  -show_entries stream=codec_type,codec_name,width,height,sample_rate,channels \
  -of default=noprint_wrappers=1 \
  rtsp://127.0.0.1:18554/E2E-Camera > "$probe"
grep -q 'codec_name=h264' "$probe"
grep -q 'codec_name=aac' "$probe"
grep -q 'width=1280' "$probe"
grep -q 'height=720' "$probe"
grep -q 'sample_rate=16000' "$probe"

GO2RTC_E2E_URL=http://127.0.0.1:11984 \
GO2RTC_E2E_STREAM=E2E-Camera \
GO2RTC_E2E_TONE=$tone \
GO2RTC_E2E_TALKBACK=$talkback_base \
  npm exec -- vitest run test/go2rtc-live.test.ts

test -s "$talkback_base.pcma"
talkback_bytes=$(wc -c < "$talkback_base.pcma" | tr -d ' ')
printf 'bytes=%s\n' "$talkback_bytes" > "$talkback_base.txt"
ffmpeg -hide_banner -loglevel error -y \
  -f alaw -ar 8000 -ac 1 -i "$talkback_base.pcma" \
  -c:a pcm_s16le "$runtime_dir/talkback.wav"
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels \
  -of default=noprint_wrappers=1 "$runtime_dir/talkback.wav" > "$runtime_dir/talkback-probe.txt"
grep -q 'codec_name=pcm_s16le' "$runtime_dir/talkback-probe.txt"
grep -q 'sample_rate=8000' "$runtime_dir/talkback-probe.txt"
grep -q 'channels=1' "$runtime_dir/talkback-probe.txt"
if grep -q 'ffmpeg:http://.*intercom' "$log"; then
  echo 'go2rtc started an unexpected PCMA talkback transcoder' >&2
  exit 4
fi

printf 'go2rtc E2E: PASS version=%s\n' "$go2rtc_version"
printf '  source: H.264 1280x720 + AAC mono 16 kHz via RTSP\n'
printf '  return audio: plugin-encoded PCMA/WAV -> direct go2rtc route -> PCMA payload\n'
printf '  artifacts: %s\n' "$runtime_dir"
