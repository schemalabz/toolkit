#!/usr/bin/env bash
set -euo pipefail

# Build the poster-qr sidecar binary using bun.
# Builds for the current platform by default, or all platforms with --all.
# Run from the repository root: bash app/build-sidecar.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$SCRIPT_DIR/src-tauri/binaries"
ENTRY="$REPO_ROOT/tools/poster-qr/sidecar.ts"

mkdir -p "$OUT_DIR"

build_target() {
  local bun_target="$1"
  local triple="$2"
  echo "Building sidecar for $triple..."
  bun build --compile \
    --target="$bun_target" \
    "$ENTRY" \
    --outfile "$OUT_DIR/poster-qr-sidecar-$triple"
}

if [[ "${1:-}" == "--all" ]]; then
  build_target bun-darwin-arm64  aarch64-apple-darwin
  build_target bun-darwin-x64    x86_64-apple-darwin
  build_target bun-linux-x64     x86_64-unknown-linux-gnu
  build_target bun-linux-arm64   aarch64-unknown-linux-gnu
else
  # Build for current platform only
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  build_target bun-darwin-arm64  aarch64-apple-darwin ;;
    Darwin-x86_64) build_target bun-darwin-x64    x86_64-apple-darwin ;;
    Linux-x86_64)  build_target bun-linux-x64     x86_64-unknown-linux-gnu ;;
    Linux-aarch64) build_target bun-linux-arm64   aarch64-unknown-linux-gnu ;;
    *) echo "Unsupported platform: $(uname -s)-$(uname -m)"; exit 1 ;;
  esac
fi

echo ""
echo "Done. Binaries:"
ls -lh "$OUT_DIR"/poster-qr-sidecar-*
