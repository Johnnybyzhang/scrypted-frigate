#!/bin/sh
# Capture go2rtc's PCMA backchannel for an E2E assertion.
set -eu
umask 077

output_base=${1:?output base path is required}
output_dir=$(dirname -- "$output_base")
mkdir -p "$output_dir"
cat > "$output_base.alaw"
