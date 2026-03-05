#!/usr/bin/env bash
set -euo pipefail

# Build sidecar binaries using bun.
# Builds for the current platform by default, or all platforms with --all.
# Run from the repository root: bash app/build-sidecar.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$SCRIPT_DIR/src-tauri/binaries"

mkdir -p "$OUT_DIR"

SIDECARS=(
  "tools/poster-qr/sidecar.ts:poster-qr-sidecar"
  "tools/yt-download/sidecar.ts:yt-download-sidecar"
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

if [[ "${1:-}" == "--all" ]]; then
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
