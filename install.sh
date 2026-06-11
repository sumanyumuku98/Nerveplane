#!/bin/sh
# Nerveplane installer — downloads the prebuilt standalone binary (no Bun needed).
#   curl -fsSL https://raw.githubusercontent.com/sumanyumuku98/Nerveplane/main/install.sh | sh
set -eu

REPO="sumanyumuku98/Nerveplane"
BIN="nerveplane"
DEST="${NERVEPLANE_BIN_DIR:-$HOME/.local/bin}"

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "Unsupported OS: $os. Install Bun (https://bun.sh) and run: npm i -g nerveplane" >&2; exit 1 ;;
esac
case "$arch" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
  *) echo "Unsupported arch: $arch" >&2; exit 1 ;;
esac

asset="${BIN}-${os}-${arch}"
url="https://github.com/${REPO}/releases/latest/download/${asset}"

echo "Downloading ${asset}…"
mkdir -p "$DEST"
curl -fsSL "$url" -o "$DEST/$BIN"
chmod +x "$DEST/$BIN"
echo "Installed $BIN → $DEST/$BIN"

case ":$PATH:" in
  *":$DEST:"*) ;;
  *) echo "Add to your PATH:  export PATH=\"$DEST:\$PATH\"" ;;
esac

"$DEST/$BIN" --version 2>/dev/null || true
echo "Next: nerveplane daemon  ·  nerveplane init  ·  nerveplane install claude-code"
