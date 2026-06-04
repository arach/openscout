#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
DIST_DIR="$APP_DIR/dist"
CONFIG_PATH="$APP_DIR/hudson-package.json"
VERSION="${VERSION:-${1:-$(node -p "require('$REPO_ROOT/package.json').version" 2>/dev/null || echo '0.1.0')}}"
DMG_PATH="$DIST_DIR/OpenScout-${VERSION}.dmg"
LATEST_DMG_PATH="$DIST_DIR/OpenScout.dmg"

HUDSON_DIR="${HUDSON_DIR:-$REPO_ROOT/../hudson}"
HKIT_BIN="${HKIT_BIN:-$HUDSON_DIR/packages/tools/hkit/bin/hkit.mjs}"
SKIP_NOTARIZE="${SKIP_NOTARIZE:-0}"
SKIP_SIGN="${SKIP_SIGN:-0}"

if [ ! -f "$HKIT_BIN" ]; then
    echo "Error: Hudson hkit packager not found at $HKIT_BIN"
    echo "Set HUDSON_DIR or HKIT_BIN. OpenScout packaging intentionally uses the local Hudson file path."
    exit 1
fi

args=(
    "$HKIT_BIN"
    package
    macos
    --config "$CONFIG_PATH"
    --version "$VERSION"
)

if [ -n "${OPENSCOUT_SIGN_IDENTITY:-}" ]; then
    args+=(--sign-identity "$OPENSCOUT_SIGN_IDENTITY")
fi

if [ -n "${OPENSCOUT_NOTARY_PROFILE:-}" ]; then
    args+=(--notary-profile "$OPENSCOUT_NOTARY_PROFILE")
fi

if [ "$SKIP_SIGN" = "1" ]; then
    args+=(--skip-sign)
fi

if [ "$SKIP_NOTARIZE" = "1" ]; then
    args+=(--local)
fi

echo "==> Building OpenScout installer $VERSION via local Hudson"
echo "    Hudson: $HUDSON_DIR"
echo "    Config: $CONFIG_PATH"

node "${args[@]}"

echo ""
echo "==> Done: $DMG_PATH"
if [ -f "$DMG_PATH" ]; then
    ls -lh "$DMG_PATH"
fi
if [ -f "$LATEST_DMG_PATH" ]; then
    echo "==> Latest alias: $LATEST_DMG_PATH"
fi
if [ "$SKIP_SIGN" != "1" ]; then
    spctl --assess --type open --context context:primary-signature -v "$DMG_PATH" 2>&1 || true
fi
