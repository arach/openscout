#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
DIST_DIR="$APP_DIR/dist"
APP_NAME="OpenScoutMenu.app"
APP_BUNDLE="$DIST_DIR/$APP_NAME"
DMG_NAME="OpenScoutMenu.dmg"
DMG_PATH="$DIST_DIR/$DMG_NAME"
VERSION="${VERSION:-${1:-$(node -p "require('$REPO_ROOT/package.json').version" 2>/dev/null || echo '0.1.0')}}"

SIGN_IDENTITY="${OPENSCOUT_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | grep -o '"Developer ID Application:[^"]*"' | head -1 | tr -d '"' || echo "")}"
NOTARY_PROFILE="${OPENSCOUT_NOTARY_PROFILE:-notarytool}"
SKIP_NOTARIZE="${SKIP_NOTARIZE:-0}"

if [ -z "$SIGN_IDENTITY" ]; then
    echo "Error: No Developer ID Application identity found."
    echo "Set OPENSCOUT_SIGN_IDENTITY or install a Developer ID certificate."
    exit 1
fi

if [ "$SKIP_NOTARIZE" != "1" ]; then
    if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
        echo "Error: notarytool profile '$NOTARY_PROFILE' is not configured."
        echo "Set OPENSCOUT_NOTARY_PROFILE or run xcrun notarytool store-credentials."
        exit 1
    fi
fi

echo "==> Building OpenScout Menu $VERSION"
bun "$APP_DIR/bin/openscout-menu.ts" build --version "$VERSION" --sign-identity "$SIGN_IDENTITY" --require-sign-identity

if [ ! -d "$APP_BUNDLE" ]; then
    echo "Error: app bundle not found at $APP_BUNDLE"
    exit 1
fi

echo "==> Creating DMG"
rm -f "$DMG_PATH"
DMG_STAGING="$(mktemp -d)"
cp -R "$APP_BUNDLE" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"

hdiutil create \
    -volname "OpenScout Menu" \
    -srcfolder "$DMG_STAGING" \
    -ov \
    -format UDZO \
    "$DMG_PATH"

rm -rf "$DMG_STAGING"

echo "==> Signing DMG"
codesign --force --timestamp \
    --sign "$SIGN_IDENTITY" \
    "$DMG_PATH"

if [ "$SKIP_NOTARIZE" = "1" ]; then
    echo "==> Skipping notarization"
else
    echo "==> Notarizing DMG"
    xcrun notarytool submit "$DMG_PATH" \
        --keychain-profile "$NOTARY_PROFILE" \
        --wait

    echo "==> Stapling DMG"
    xcrun stapler staple "$DMG_PATH"
fi

echo ""
echo "==> Done: $DMG_PATH"
ls -lh "$DMG_PATH"
spctl --assess --type open --context context:primary-signature -v "$DMG_PATH" 2>&1 || true
