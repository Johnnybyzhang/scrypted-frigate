#!/bin/sh
# Capture encoded go2rtc backchannel payloads for an E2E assertion.
set -eu
umask 077

output=${1:?output path is required}
output_dir=$(dirname -- "$output")
mkdir -p "$output_dir"
cat > "$output"
