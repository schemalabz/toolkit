#!/usr/bin/env bash
set -euo pipefail

# Smoke-test yt-download's dependency provisioning on a real runner.
#
# Every interesting failure mode here is platform-specific and invisible on the
# machine that wrote the code:
#   - Deno's release asset name differs per OS and arch, so a wrong guess 404s.
#   - Deno ships zipped, so extraction shells out to unzip (or ditto on macOS).
#   - macOS quarantines freshly downloaded binaries; they refuse to execute
#     until the xattrs are stripped.
# Running each binary is the assertion that matters — merely existing on disk
# proves none of the above.
#
# The YouTube download itself is deliberately NOT exercised: CI runners have
# datacenter IPs that YouTube blocks independently of anything we control, so a
# failure there would say nothing about this code. The yt-dlp/Deno wiring is
# still asserted below, via a bogus URL scheme that never reaches the network.

DATA_DIR="$(mktemp -d)"
trap 'rm -rf "$DATA_DIR"' EXIT

BIN_DIR="$DATA_DIR/bin"
EVENTS="$DATA_DIR/events.jsonl"

PAYLOAD=$(printf '{"action":"ensure-deps","dataDir":"%s"}' "$DATA_DIR" | base64 | tr -d '\n')

echo "--- running ensure-deps ---"
# Progress events are one line per chunk; keep the log readable.
bun tools/yt-download/sidecar.ts "$PAYLOAD" > "$EVENTS"
grep -v '"download-progress"' "$EVENTS" || true

if ! grep -q '"type":"deps-ready"' "$EVENTS"; then
  echo "FAIL: ensure-deps never reported deps-ready"
  exit 1
fi

echo "--- asserting each binary executes ---"
for bin in yt-dlp ffmpeg deno; do
  if [ ! -x "$BIN_DIR/$bin" ]; then
    echo "FAIL: $bin missing or not executable at $BIN_DIR/$bin"
    exit 1
  fi
done

"$BIN_DIR/deno" --version
"$BIN_DIR/yt-dlp" --version
"$BIN_DIR/ffmpeg" -version > /dev/null && echo "ffmpeg ok"

echo "--- asserting yt-dlp actually loads Deno as its JS runtime ---"
# yt-dlp prints "JS runtimes: deno-<version>" only after probing the binary, so
# this fails if the path is wrong or the binary won't run. The URL scheme is
# unsupported on purpose: the debug header prints before any network request,
# and the resulting error is expected, hence the guarded exit status.
RUNTIME_LOG="$DATA_DIR/runtime.log"
"$BIN_DIR/yt-dlp" --no-update -v \
  --js-runtimes "deno:$BIN_DIR/deno" \
  --simulate "notaurl:///x" > "$RUNTIME_LOG" 2>&1 || true

if ! grep -qE '^\[debug\] JS runtimes: deno-' "$RUNTIME_LOG"; then
  echo "FAIL: yt-dlp did not report Deno as an available JS runtime"
  grep -iE 'js runtime|jsc' "$RUNTIME_LOG" || cat "$RUNTIME_LOG"
  exit 1
fi

grep -E '^\[debug\] JS runtimes:' "$RUNTIME_LOG"
echo "OK: deps provision and yt-dlp loads Deno"
