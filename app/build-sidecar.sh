#!/usr/bin/env bash
set -euo pipefail

# Build sidecar binaries using bun.
# Builds for the current platform by default, all platforms with --all, or the
# macOS universal set (both arches plus a lipo'd universal) with --universal-darwin.
# Run from the repository root: bash app/build-sidecar.sh
#
# CI calls this rather than repeating the build commands: SIDECARS below is the
# single list of what the app bundles, and a second copy silently drifts — a
# sidecar added here but not there fails the Tauri build with "resource path ...
# doesn't exist".

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$SCRIPT_DIR/src-tauri/binaries"

mkdir -p "$OUT_DIR"

SIDECARS=(
  "tools/poster-qr/sidecar.ts:poster-qr-sidecar"
  "tools/yt-download/sidecar.ts:yt-download-sidecar"
  "tools/video-edit/sidecar.ts:video-edit-sidecar"
)

build_sidecar() {
  local entry="$REPO_ROOT/$1"
  local name="$2"
  local bun_target="$3"
  local triple="$4"
  echo "Building $name for $triple..."
  bun build --compile \
    --target="$bun_target" \
    "$entry" \
    --outfile "$OUT_DIR/$name-$triple"
}

build_all_sidecars() {
  local bun_target="$1"
  local triple="$2"
  for spec in "${SIDECARS[@]}"; do
    local entry="${spec%%:*}"
    local name="${spec##*:}"
    build_sidecar "$entry" "$name" "$bun_target" "$triple"
  done
}

# Tauri's universal-apple-darwin target needs each arch's binary *and* the lipo'd
# universal one, so all three are produced.
build_universal_darwin() {
  build_all_sidecars bun-darwin-arm64 aarch64-apple-darwin
  build_all_sidecars bun-darwin-x64   x86_64-apple-darwin
  for spec in "${SIDECARS[@]}"; do
    local name="${spec##*:}"
    echo "Creating universal $name..."
    lipo -create \
      "$OUT_DIR/$name-aarch64-apple-darwin" \
      "$OUT_DIR/$name-x86_64-apple-darwin" \
      -output "$OUT_DIR/$name-universal-apple-darwin"
  done
}

if [[ "${1:-}" == "--universal-darwin" ]]; then
  build_universal_darwin
elif [[ "${1:-}" == "--all" ]]; then
  build_all_sidecars bun-darwin-arm64  aarch64-apple-darwin
  build_all_sidecars bun-darwin-x64    x86_64-apple-darwin
  build_all_sidecars bun-linux-x64     x86_64-unknown-linux-gnu
  build_all_sidecars bun-linux-arm64   aarch64-unknown-linux-gnu
else
  # Build for current platform only
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  build_all_sidecars bun-darwin-arm64  aarch64-apple-darwin ;;
    Darwin-x86_64) build_all_sidecars bun-darwin-x64    x86_64-apple-darwin ;;
    Linux-x86_64)  build_all_sidecars bun-linux-x64     x86_64-unknown-linux-gnu ;;
    Linux-aarch64) build_all_sidecars bun-linux-arm64   aarch64-unknown-linux-gnu ;;
    *) echo "Unsupported platform: $(uname -s)-$(uname -m)"; exit 1 ;;
  esac
fi

echo ""
echo "Done. Binaries:"
ls -lh "$OUT_DIR"/*-sidecar-*
